import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { billingCatalog, type BillingSku, employerPlans, type EmployerPlanSku } from "@/lib/billing/catalog";
import { createClient } from "@supabase/supabase-js";
import { partnerService } from "@/lib/partners/service";

export const runtime = "nodejs";

const EMPLOYER_TIERS = ["starter", "growth", "business"] as const;

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase service credentials are not configured.");
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

type EmployerSyncTarget = {
  orgId: string;
  tier: (typeof EMPLOYER_TIERS)[number];
  plan: (typeof employerPlans)[EmployerPlanSku];
};

/** Derive an employer-sync target from Stripe metadata. Returns null when the
 * event does not belong to an Odesseus employer subscription. */
function employerSyncFromMetadata(metadata?: Stripe.Metadata | null): EmployerSyncTarget | null {
  const orgId = metadata?.odesseus_org_id;
  const tier = metadata?.odesseus_tier;
  if (!orgId || !tier || !EMPLOYER_TIERS.includes(tier as (typeof EMPLOYER_TIERS)[number])) return null;
  const plan = Object.values(employerPlans).find((p) => p.tier === tier);
  if (!plan) return null;
  return { orgId, tier: tier as (typeof EMPLOYER_TIERS)[number], plan };
}

/** Shared employer subscription sync used by invoice.paid and the
 * customer.subscription.* lifecycle events. Money-verified periods pass
 * grantCredits=true (only these may grant job-post credits). */
async function syncEmployerSubscription(
  supabase: ReturnType<typeof createServiceClient>,
  target: EmployerSyncTarget,
  args: {
    status: string;
    stripeSubscriptionId: string | null;
    stripeCustomerId: string | null;
    periodStart: Date | null;
    periodEnd: Date | null;
    grantCredits: boolean;
  }
) {
  const { error } = await supabase.rpc("odesseus_sync_employer_subscription", {
    p_org_id: target.orgId,
    p_tier: target.tier,
    p_status: args.status,
    p_stripe_subscription_id: args.stripeSubscriptionId,
    p_stripe_customer_id: args.stripeCustomerId,
    p_period_start: args.periodStart?.toISOString() ?? null,
    p_period_end: args.periodEnd?.toISOString() ?? null,
    p_grant_credits: args.grantCredits,
  });
  if (error) throw error;
}

// invoice.paid is the money-verified employer event: the charged amount must
// match the plan's catalog price or the webhook fails closed without granting
// a cycle's job-post credits. A replayed event is a no-op — the sync RPC keys
// its credit grant on the subscription period, so the same period can only
// grant once (also mirrored in the migration's idempotency tests).
async function handleInvoicePaid(invoice: Stripe.Invoice) {
  // In this Stripe API version the subscription that generated the invoice and
  // its metadata snapshot live under invoice.parent.subscription_details.
  const sync = employerSyncFromMetadata(invoice.parent?.subscription_details?.metadata);
  if (!sync) return NextResponse.json({ received: true });

  // Fail closed like the checkout path: an invoice charged for an amount or
  // currency that does not match the employer plan must not grant credits.
  const charged = invoice.amount_paid ?? invoice.total;
  const currency = invoice.currency ?? "usd";
  if (charged !== sync.plan.amountCents || currency !== "usd") {
    return NextResponse.json(
      { error: "Invoice amount or currency does not match the employer plan." },
      { status: 400 }
    );
  }

  const parentSubscription = invoice.parent?.subscription_details?.subscription;
  const subscriptionId =
    typeof parentSubscription === "string" ? parentSubscription : null;
  const periodStart = invoice.period_start ? new Date(invoice.period_start * 1000) : null;
  const periodEnd = invoice.period_end ? new Date(invoice.period_end * 1000) : null;

  try {
    const supabase = createServiceClient();
    await syncEmployerSubscription(supabase, sync, {
      status: "active",
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: typeof invoice.customer === "string" ? invoice.customer : null,
      periodStart,
      periodEnd,
      grantCredits: true,
    });
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[ODESSEUS_EMPLOYER] subscription sync failed", error);
    return NextResponse.json({ error: "Could not sync employer subscription." }, { status: 500 });
  }
}

// Lifecycle events (updated/deleted) sync subscription status only — credits
// are granted exclusively by the money-verified invoice.paid path. A deleted
// subscription is recorded as canceled so the org stops accruing quota.
// Subscription objects in this API version carry no current_period timestamps,
// so status-only sync passes null periods; the RPC's upsert coalesces them with
// the paid period recorded by invoice.paid instead of wiping it.
async function handleSubscriptionLifecycle(
  subscription: Stripe.Subscription,
  eventType: "customer.subscription.updated" | "customer.subscription.deleted"
) {
  const sync = employerSyncFromMetadata(subscription.metadata);
  if (!sync) return NextResponse.json({ received: true });

  const status = eventType === "customer.subscription.deleted" ? "canceled" : subscription.status;
  if (!["active", "past_due", "canceled", "trialing", "incomplete"].includes(status)) {
    return NextResponse.json({ received: true });
  }

  try {
    const supabase = createServiceClient();
    await syncEmployerSubscription(supabase, sync, {
      status,
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : null,
      periodStart: null,
      periodEnd: null,
      grantCredits: false,
    });
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[ODESSEUS_EMPLOYER] subscription lifecycle sync failed", error);
    return NextResponse.json({ error: "Could not sync employer subscription." }, { status: 500 });
  }
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

  if (event.type === "invoice.paid") {
    return handleInvoicePaid(event.data.object as Stripe.Invoice);
  }

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    return handleSubscriptionLifecycle(event.data.object as Stripe.Subscription, event.type);
  }

  if (event.type !== "checkout.session.completed") return NextResponse.json({ received: true });

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== "paid") return NextResponse.json({ received: true });

  const userId = session.metadata?.odesseus_user_id;
  const sku = session.metadata?.sku as BillingSku | undefined;
  if (!userId || !sku || !billingCatalog[sku]) return NextResponse.json({ error: "Invalid checkout metadata." }, { status: 400 });

  const item = billingCatalog[sku];

  // The checkout session is created by our server with the catalog price and
  // quantity 1 (mode: "payment"), but the webhook is the enforcement point:
  // a session whose charged amount or currency does not match the sellable
  // catalog must fail closed instead of crediting the catalog delta for a
  // different price. Mirrored by tests/integration/stripe-fulfillment.test.ts.
  const charged = session.amount_total;
  const currency = session.currency ?? "usd";
  if (charged !== item.amountCents || currency !== "usd") {
    return NextResponse.json(
      { error: "Checkout amount or currency does not match the catalog." },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("billing_events").insert({
    stripe_event_id: event.id,
    checkout_session_id: session.id,
    user_id: userId,
    credit_type: item.creditType,
    credit_delta: item.creditDelta,
    sku,
    amount_cents: charged,
    currency,
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
          const amountCents = charged;
          const commissionCents = Math.floor((amountCents * commissionBps) / 10_000);

          const { data: conversion } = await service
            .from("partner_conversions")
            .insert({
              partner_id: partner.id,
              referral_id: referral.id,
              user_id: userId,
              billing_event_id: billingEvent.id,
              amount_cents: amountCents,
              currency,
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
              currency,
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
