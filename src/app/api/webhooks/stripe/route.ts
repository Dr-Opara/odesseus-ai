import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { billingCatalog, type BillingSku, employerPlans, type EmployerPlanSku, employerRecruiterSeat, employerFeaturedTiers, type EmployerFeaturedTier, employerPlanForAmount } from "@/lib/billing/catalog";
import { createClient } from "@supabase/supabase-js";
import { partnerService } from "@/lib/partners/service";
import { logWebhookEvent } from "@/lib/observability/events";

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

type RecruiterSeatSyncTarget = {
  orgId: string;
  seatCount: number;
};

/** Derive an employer-sync target from Stripe metadata. Returns null when the
 * event does not belong to an Odesseus employer subscription.
 *
 * The org id always comes from metadata, because that is the one thing Stripe
 * does not change when a customer switches plan. The tier is metadata's answer
 * only as a *fallback*: see `employerPlanTargetForAmount`. */
function employerSyncFromMetadata(metadata?: Stripe.Metadata | null): EmployerSyncTarget | null {
  const orgId = metadata?.odesseus_org_id;
  const tier = metadata?.odesseus_tier;
  if (!orgId || !tier || !EMPLOYER_TIERS.includes(tier as (typeof EMPLOYER_TIERS)[number])) return null;
  const plan = Object.values(employerPlans).find((p) => p.tier === tier);
  if (!plan) return null;
  return { orgId, tier: tier as (typeof EMPLOYER_TIERS)[number], plan };
}

/**
 * An employer-sync target for an invoice, with the plan taken from the amount
 * actually charged.
 *
 * `odesseus_tier` is written once, when the subscription is created. A customer
 * who upgrades -- in the Stripe dashboard or the customer portal -- changes the
 * price and leaves the metadata saying `starter`. Using metadata here had two
 * consequences, and both bit real customers:
 *
 *   1. The upgrade's own invoice charged the new amount, was compared against
 *      the old plan's price, mismatched, and was answered 400. Stripe marks the
 *      endpoint failing and retries, and the new cycle's job-post credits are
 *      never granted.
 *   2. `customer.subscription.updated` recorded the old tier, so the org kept
 *      the old quota until the metadata was corrected by hand.
 *
 * Resolving the plan from the charged amount fixes both without loosening the
 * check: a plan is only ever returned when the charge is exactly that plan's
 * catalog price, so an invoice for an amount that is not a catalog price is
 * still rejected below.
 */
function employerPlanTargetForAmount(
  amountCents: number | null | undefined,
  metadata?: Stripe.Metadata | null
): EmployerSyncTarget | null {
  const plan = employerPlanForAmount(amountCents);
  if (!plan) return null;
  const orgId = metadata?.odesseus_org_id;
  if (!orgId) return null;
  return { orgId, tier: plan.tier, plan };
}

/**
 * The recurring price a subscription is currently charging, per period.
 *
 * Used so `customer.subscription.updated` can see a plan change. A subscription
 * carries its own line items, and each item's `unit_amount` is the plan price
 * regardless of quantity, so an employer plan resolves to exactly one catalog
 * entry. Null when there is no usable line item.
 */
function subscriptionPeriodUnitAmount(subscription: Stripe.Subscription): number | null {
  const item = subscription.items?.data?.[0];
  // This Stripe API version keeps the amount on the nested price, not on the
  // subscription item itself.
  const amount = item?.price?.unit_amount ?? null;
  return typeof amount === "number" ? amount : null;
}

/** Derive a recruiter-seat sync target from Stripe metadata. Requires the
 * explicit odesseus_recruiter_seats marker and a positive seat count; sessions
 * without it are not recruiter-seat subscriptions. */
function recruiterSeatSyncFromMetadata(metadata?: Stripe.Metadata | null): RecruiterSeatSyncTarget | null {
  if (metadata?.odesseus_recruiter_seats !== "true") return null;
  const orgId = metadata?.odesseus_org_id;
  const seatCount = Number(metadata?.odesseus_seat_count);
  if (!orgId || !Number.isInteger(seatCount) || seatCount < 1) return null;
  return { orgId, seatCount };
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

/** Shared recruiter-seat sync used by invoice.paid and the
 * customer.subscription.* lifecycle events. The seat count always originates
 * from the money-verified path; status-only events pass their metadata count
 * (the RPC voids it for canceled/incomplete rather than adding seats). */
async function syncRecruiterSeat(
  supabase: ReturnType<typeof createServiceClient>,
  target: RecruiterSeatSyncTarget,
  args: {
    status: string;
    stripeSubscriptionId: string | null;
    stripeCustomerId: string | null;
    periodStart: Date | null;
    periodEnd: Date | null;
  }
) {
  const { error } = await supabase.rpc("odesseus_sync_recruiter_seat", {
    p_org_id: target.orgId,
    p_count: target.seatCount,
    p_status: args.status,
    p_stripe_subscription_id: args.stripeSubscriptionId,
    p_stripe_customer_id: args.stripeCustomerId,
    p_period_start: args.periodStart?.toISOString() ?? null,
    p_period_end: args.periodEnd?.toISOString() ?? null,
  });
  if (error) throw error;
}

// invoice.paid is the money-verified employer event: the charged amount must
// match the plan's catalog price or the webhook fails closed without granting
// a cycle's job-post credits. A replayed event is a no-op — the sync RPC keys
// its credit grant on the subscription period, so the same period can only
// grant once (also mirrored in the migration's idempotency tests).
//
// The plan is derived from the charged amount, not from `odesseus_tier`
// metadata, so an upgrade or downgrade grants the tier that was actually paid
// for. See `employerPlanTargetForAmount`.
async function handleInvoicePaid(invoice: Stripe.Invoice, event: Stripe.Event) {
  // In this Stripe API version the subscription that generated the invoice and
  // its metadata snapshot live under invoice.parent.subscription_details.
  const metadata = invoice.parent?.subscription_details?.metadata;

  // Recruiter seats are their own subscription with a seat-counted price: the
  // paid amount must equal seatCount x $20, or the webhook fails closed.
  const seatTarget = recruiterSeatSyncFromMetadata(metadata);
  if (seatTarget) return handleRecruiterSeatInvoicePaid(invoice, seatTarget, event);

  const charged = invoice.amount_paid ?? invoice.total;
  const currency = invoice.currency ?? "usd";

  const sync = employerPlanTargetForAmount(charged, metadata);
  if (!sync) {
    // Distinguish a wholly foreign invoice from an Odesseus employer invoice
    // that charged a price we do not sell. The first is ignored; the second is
    // a pricing problem and must fail closed rather than paper over itself with
    // the metadata tier, because metadata is exactly what a stale upgrade
    // leaves behind.
    if (!employerSyncFromMetadata(metadata)) {
      await logWebhookEvent({
        stripeEventId: event.id,
        eventType: event.type,
        outcome: "ignored",
        httpStatus: 200,
        reason: "Invoice is not an Odesseus employer or seat subscription.",
      });
      return NextResponse.json({ received: true });
    }

    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "rejected",
      httpStatus: 400,
      orgId: metadata?.odesseus_org_id ?? null,
      reason: "Invoice amount or currency does not match the employer plan.",
    });
    return NextResponse.json(
      { error: "Invoice amount or currency does not match the employer plan." },
      { status: 400 }
    );
  }

  // The amount already matched a catalog plan price, so what is left to verify is
  // the currency: every plan we sell is a USD price.
  if (currency !== "usd") {
    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "rejected",
      httpStatus: 400,
      orgId: sync.orgId,
      reason: "Invoice amount or currency does not match the employer plan.",
    });
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
    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "fulfilled",
      httpStatus: 200,
      orgId: sync.orgId,
      details: { tier: sync.tier },
    });
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[ODESSEUS_EMPLOYER] subscription sync failed", error);
    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "errored",
      httpStatus: 500,
      orgId: sync.orgId,
      reason: "Employer subscription sync failed.",
    });
    return NextResponse.json({ error: "Could not sync employer subscription." }, { status: 500 });
  }
}

// Recruiter-seat invoices are seat-counted: charged == seatCount x $20. Any
// mismatch is a 400 and nothing is synced (no silent entitlement).
//
// One exception, and it is an important one: a seat quantity *downgrade* issues a
// proration invoice for the unused remainder of the period. That invoice is a
// credit, not a payment for seats, so its amount will never equal
// seatCount x $20. Treating it as a tampered invoice would answer 400 on a
// completely legitimate billing event, which makes Stripe mark this endpoint as
// failing and retry it. It is recorded as `ignored` and grants nothing -- the
// quantity change itself is already applied by the `customer.subscription.updated`
// event that accompanies it. The security property is unchanged: a renewal
// invoice must still match the seat count exactly before any seat is granted.
async function handleRecruiterSeatInvoicePaid(
  invoice: Stripe.Invoice,
  target: RecruiterSeatSyncTarget,
  event: Stripe.Event
) {
  if (invoice.billing_reason === "subscription_update") {
    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "ignored",
      httpStatus: 200,
      orgId: target.orgId,
      reason: "Seat proration invoice from a quantity change; no entitlement granted.",
      details: { seatCount: target.seatCount },
    });
    return NextResponse.json({ received: true });
  }

  const charged = invoice.amount_paid ?? invoice.total;
  const currency = invoice.currency ?? "usd";
  const expected = target.seatCount * employerRecruiterSeat.amountCents;
  if (charged !== expected || currency !== "usd") {
    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "rejected",
      httpStatus: 400,
      orgId: target.orgId,
      reason: "Invoice amount or currency does not match the recruiter seat price.",
    });
    return NextResponse.json(
      { error: "Invoice amount or currency does not match the recruiter seat price." },
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
    await syncRecruiterSeat(supabase, target, {
      status: "active",
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: typeof invoice.customer === "string" ? invoice.customer : null,
      periodStart,
      periodEnd,
    });
    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "fulfilled",
      httpStatus: 200,
      orgId: target.orgId,
      details: { seatCount: target.seatCount },
    });
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[ODESSEUS_EMPLOYER] recruiter seat sync failed", error);
    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "errored",
      httpStatus: 500,
      orgId: target.orgId,
      reason: "Recruiter seat sync failed.",
    });
    return NextResponse.json({ error: "Could not sync recruiter seats." }, { status: 500 });
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
  eventType: "customer.subscription.updated" | "customer.subscription.deleted",
  event: Stripe.Event
) {
  const seatTarget = recruiterSeatSyncFromMetadata(subscription.metadata);
  // Prefer the tier the subscription is actually charging. Metadata is written
  // once at creation and does not follow a plan change made in the dashboard or
  // the customer portal, so trusting it here left an upgraded org on its old
  // plan until someone corrected Stripe by hand. Falls back to metadata when the
  // price is not a catalog price, which is the right answer for a discounted
  // price an operator configured deliberately.
  const planTarget =
    employerPlanTargetForAmount(
      subscriptionPeriodUnitAmount(subscription),
      subscription.metadata
    ) ?? employerSyncFromMetadata(subscription.metadata);
  if (!seatTarget && !planTarget) {
    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "ignored",
      httpStatus: 200,
      reason: "Subscription is not an Odesseus employer or seat subscription.",
    });
    return NextResponse.json({ received: true });
  }

  const status = eventType === "customer.subscription.deleted" ? "canceled" : subscription.status;
  if (!["active", "past_due", "canceled", "trialing", "incomplete"].includes(status)) {
    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "ignored",
      httpStatus: 200,
      orgId: (seatTarget ?? planTarget)?.orgId,
      reason: `Subscription status requires no sync: ${status}.`,
    });
    return NextResponse.json({ received: true });
  }

  try {
    const supabase = createServiceClient();
    const stripeCustomerId = typeof subscription.customer === "string" ? subscription.customer : null;
    if (seatTarget) {
      await syncRecruiterSeat(supabase, seatTarget, {
        status,
        stripeSubscriptionId: subscription.id,
        stripeCustomerId,
        periodStart: null,
        periodEnd: null,
      });
    } else if (planTarget) {
      await syncEmployerSubscription(supabase, planTarget, {
        status,
        stripeSubscriptionId: subscription.id,
        stripeCustomerId,
        periodStart: null,
        periodEnd: null,
        grantCredits: false,
      });
    }
    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "fulfilled",
      httpStatus: 200,
      orgId: (seatTarget ?? planTarget)?.orgId,
      details: { status },
    });
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[ODESSEUS_EMPLOYER] subscription lifecycle sync failed", error);
    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "errored",
      httpStatus: 500,
      orgId: (seatTarget ?? planTarget)?.orgId,
      reason: "Subscription lifecycle sync failed.",
    });
    return NextResponse.json({ error: "Could not sync employer subscription." }, { status: 500 });
  }
}

// Featured listings are one-time purchases: the checkout session must carry
// odesseus_org_id + odesseus_job_id + odesseus_featured_tier, and the charged
// amount must match the featured catalog price or the webhook fails closed
// without creating a listing. The RPC keys its insert on the payment intent,
// so a replayed event returns the original listing instead of a duplicate.
async function handleFeaturedListingCheckout(session: Stripe.Checkout.Session, event: Stripe.Event) {
  const orgId = session.metadata?.odesseus_org_id;
  const jobId = session.metadata?.odesseus_job_id;
  const tier = session.metadata?.odesseus_featured_tier as EmployerFeaturedTier | undefined;
  const item = tier ? employerFeaturedTiers[tier] : undefined;
  if (!orgId || !jobId || !item) {
    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "rejected",
      httpStatus: 400,
      orgId: orgId ?? null,
      reason: "Invalid featured checkout metadata.",
    });
    return NextResponse.json({ error: "Invalid featured checkout metadata." }, { status: 400 });
  }

  // Fail closed like the candidate path: a featured session charged for an
  // amount or currency that does not match the catalog gets nothing.
  const charged = session.amount_total;
  const currency = session.currency ?? "usd";
  if (charged !== item.amountCents || currency !== "usd") {
    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "rejected",
      httpStatus: 400,
      orgId,
      reason: "Checkout amount or currency does not match the featured listing.",
    });
    return NextResponse.json(
      { error: "Checkout amount or currency does not match the featured listing." },
      { status: 400 }
    );
  }

  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : null;
  if (!paymentIntent) {
    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "rejected",
      httpStatus: 400,
      orgId,
      reason: "Featured checkout has no payment intent.",
    });
    return NextResponse.json({ error: "Featured checkout has no payment intent." }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();
    const { error } = await supabase.rpc("odesseus_create_featured_listing", {
      p_org_id: orgId,
      p_job_id: jobId,
      p_tier: tier,
      p_stripe_payment_intent: paymentIntent,
    });
    if (error) throw error;
    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "fulfilled",
      httpStatus: 200,
      orgId,
      details: { jobId, tier },
    });
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[ODESSEUS_EMPLOYER] featured listing creation failed", error);
    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "errored",
      httpStatus: 500,
      orgId,
      reason: "Featured listing creation failed.",
    });
    return NextResponse.json({ error: "Could not create featured listing." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    await logWebhookEvent({
      stripeEventId: null,
      eventType: null,
      outcome: "errored",
      httpStatus: 500,
      reason: "Webhook is not configured.",
    });
    return NextResponse.json({ error: "Webhook is not configured." }, { status: 500 });
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    await logWebhookEvent({
      stripeEventId: null,
      eventType: null,
      outcome: "rejected",
      httpStatus: 400,
      reason: "Missing signature.",
    });
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, webhookSecret);
  } catch {
    await logWebhookEvent({
      stripeEventId: null,
      eventType: null,
      outcome: "rejected",
      httpStatus: 400,
      reason: "Invalid signature.",
    });
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

    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "fulfilled",
      httpStatus: 200,
      details: { paymentIntent },
    });
    return NextResponse.json({ received: true });
  }

  if (event.type === "invoice.paid") {
    return handleInvoicePaid(event.data.object as Stripe.Invoice, event);
  }

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    return handleSubscriptionLifecycle(event.data.object as Stripe.Subscription, event.type, event);
  }

  if (event.type !== "checkout.session.completed") {
    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "ignored",
      httpStatus: 200,
      reason: "Event type has no fulfillment path.",
    });
    return NextResponse.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== "paid") {
    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "ignored",
      httpStatus: 200,
      reason: "Checkout session was not paid.",
    });
    return NextResponse.json({ received: true });
  }

  // Employer featured listings are one-time checkout purchases (not candidate
  // wallet/earner SKUs). Route them before the candidate catalog path.
  if (session.metadata?.odesseus_featured_tier) {
    return handleFeaturedListingCheckout(session, event);
  }

  const userId = session.metadata?.odesseus_user_id;
  const sku = session.metadata?.sku as BillingSku | undefined;
  if (!userId || !sku || !billingCatalog[sku]) {
    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "rejected",
      httpStatus: 400,
      userId: userId ?? null,
      sku: sku ?? null,
      reason: "Invalid checkout metadata.",
    });
    return NextResponse.json({ error: "Invalid checkout metadata." }, { status: 400 });
  }

  const item = billingCatalog[sku];

  // The checkout session is created by our server with the catalog price and
  // quantity 1 (mode: "payment"), but the webhook is the enforcement point:
  // a session whose charged amount or currency does not match the sellable
  // catalog must fail closed instead of crediting the catalog delta for a
  // different price. Mirrored by tests/integration/stripe-fulfillment.test.ts.
  const charged = session.amount_total;
  const currency = session.currency ?? "usd";
  if (charged !== item.amountCents || currency !== "usd") {
    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "rejected",
      httpStatus: 400,
      userId,
      sku,
      reason: "Checkout amount or currency does not match the catalog.",
    });
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
    if (error.code === "23505") {
      await logWebhookEvent({
        stripeEventId: event.id,
        eventType: event.type,
        outcome: "duplicate",
        httpStatus: 200,
        userId,
        sku,
        reason: "Duplicate delivery: purchase already fulfilled.",
      });
      return NextResponse.json({ received: true, duplicate: true });
    }
    await logWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      outcome: "errored",
      httpStatus: 500,
      userId,
      sku,
      reason: "Could not insert billing event.",
    });
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

  await logWebhookEvent({
    stripeEventId: event.id,
    eventType: event.type,
    outcome: "fulfilled",
    httpStatus: 200,
    userId,
    sku,
    checkoutSessionId: session.id,
    details: { creditType: item.creditType, creditDelta: item.creditDelta },
  });
  return NextResponse.json({ received: true });
}
