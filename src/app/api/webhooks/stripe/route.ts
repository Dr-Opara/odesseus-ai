import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { billingCatalog, type BillingSku } from "@/lib/billing/catalog";
import { createClient } from "@supabase/supabase-js";

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

  if (event.type !== "checkout.session.completed") return NextResponse.json({ received: true });

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== "paid") return NextResponse.json({ received: true });

  const userId = session.metadata?.odysseus_user_id;
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

  return NextResponse.json({ received: true });
}
