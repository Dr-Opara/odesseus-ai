import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { billingCatalog, type BillingSku } from "@/lib/billing/catalog";
import { createClient } from "@supabase/supabase-js";
import { partnerService } from "@/lib/partners/service";

export const runtime = "nodejs";

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase service credentials are not configured.");
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return NextResponse.json({ error: "Webhook is not configured." }, { status: 500 });

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const paymentIntent =
      typeof charge.payment_intent === "string" ? charge.payment_intent : null;

    if (paymentIntent) {
      try {
        const service = partnerService();
        const { data: billingEvent } = await service
          .from("billing_events")
          .select("id")
          .contains("metadata", { payment_intent: paymentIntent })
          .maybeSingle();

        if (billingEvent) {
          const { data: conversion } = await service
            .from("partner_conversions")
            .select("id")
            .eq("billing_event_id", billingEvent.id)
            .maybeSingle();

          if (conversion) {
            await service
              .from("partner_conversions")
              .update({ status: "reversed", reversed_at: new Date().toISOString() })
              .eq("id", conversion.id);
            await service
              .from("partner_earnings")
              .update({ status: "reversed", updated_at: new Date().toISOString() })
              .eq("conversion_id", conversion.id)
              .neq("status", "paid");
          }
        }
      } catch (error) {
        console.error("[ODESSEUS_PARTNERS] refund attribution reversal failed", error);
      }
    }

    return NextResponse.json({ received: true });
  }

  if (event.type !== "checkout.session.completed") return NextResponse.json({ received: true });

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== "paid") return NextResponse.json({ received: true });

  const userId = session.metadata?.odesseus_user_id;
  const sku = session.metadata?.sku as BillingSku | undefined;
  if (!userId || !sku || !billingCatalog[sku]) return NextResponse.json({ error: "Invalid checkout metadata." }, { status: 400 });

  const item = billingCatalog[sku];
  const supabase = createServiceClient();
  const { error } = await supabase.from("billing_events").insert({
    stripe_event_id: event.id,
    checkout_session_id: session.id,
    user_id: userId,
    credit_type: item.creditType,
    credit_delta: item.creditDelta,
    sku,
    amount_cents: session.amount_total ?? item.amountCents,
    currency: session.currency ?? "usd",
    stripe_customer_id: typeof session.customer === "string" ? session.customer : null,
    metadata: { payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : null },
  });

  if (error) {
    if (error.code === "23505") return NextResponse.json({ received: true, duplicate: true });
    return NextResponse.json({ error: "Could not fulfill purchase." }, { status: 500 });
  }

  // Attribute a paid purchase to a valid referred signup. Partner accounting
  // is deliberately best-effort: a referral subsystem failure must never
  // prevent a paid customer from receiving purchased credits or passes.
  try {
    const service = partnerService();
    const { data: billingEvent } = await service
      .from("billing_events")
      .select("id")
      .eq("stripe_event_id", event.id)
      .single();

    if (billingEvent) {
      const { data: referral } = await service
        .from("partner_referrals")
        .select("id,partner_id,created_at,partners!inner(id,email,user_id,status,commission_bps,attribution_days)")
        .eq("signup_user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const partner = referral?.partners;
      if (referral && partner?.status === "approved") {
        const attributionCutoff = new Date(
          Date.now() - Number(partner.attribution_days || 30) * 24 * 60 * 60 * 1000
        );
        const { data: referredUser } = await service.auth.admin.getUserById(userId);
        const referredEmail = referredUser?.user?.email?.toLowerCase() || null;
        const selfReferral =
          partner.user_id === userId ||
          (referredEmail && partner.email?.toLowerCase() === referredEmail);

        if (!selfReferral && new Date(referral.created_at) >= attributionCutoff) {
          const commissionBps = Number(partner.commission_bps || 0);
          const amountCents = session.amount_total ?? item.amountCents;
          const commissionCents = Math.floor((amountCents * commissionBps) / 10_000);

          const { data: conversion } = await service
            .from("partner_conversions")
            .insert({
              partner_id: partner.id,
              referral_id: referral.id,
              user_id: userId,
              billing_event_id: billingEvent.id,
              amount_cents: amountCents,
              currency: session.currency ?? "usd",
              commission_cents: commissionCents,
              status: "qualified",
              qualified_at: new Date().toISOString(),
            })
            .select("id")
            .maybeSingle();

          if (conversion && commissionCents > 0) {
            await service.from("partner_earnings").insert({
              partner_id: partner.id,
              conversion_id: conversion.id,
              amount_cents: commissionCents,
              currency: session.currency ?? "usd",
              status: "pending",
              reason: "Qualified referral purchase: " + sku,
            });
          }
        }
      }
    }
  } catch (error) {
    console.error("[ODESSEUS_PARTNERS] paid conversion attribution failed", error);
  }

  return NextResponse.json({ received: true });
}
