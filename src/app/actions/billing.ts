"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { billingCatalog, type BillingSku } from "@/lib/billing/catalog";

type CatalogEntry = (typeof billingCatalog)[BillingSku];

/**
 * Stripe checkout interval for a recurring Live SKU.
 *
 * A recurring SKU must be sold in `subscription` mode or Stripe will treat it
 * as a one-off charge and never emit the subscription lifecycle events the
 * membership depends on.
 */
function recurringIntervalFor(item: CatalogEntry): "month" | "year" | null {
  if (!("billing" in item) || item.billing !== "recurring") return null;
  return item.planType === "monthly" ? "month" : "year";
}

const STRIPE_PRICE_ENV_BY_SKU: Partial<Record<BillingSku, string>> = {
  wallet_10: "STRIPE_PRICE_WALLET_10",
  wallet_20: "STRIPE_PRICE_WALLET_20",
  wallet_50: "STRIPE_PRICE_WALLET_50",
  live_single: "STRIPE_PRICE_LIVE_SINGLE",
  live_monthly: "STRIPE_PRICE_LIVE_MONTHLY",
  live_personal_annual: "STRIPE_PRICE_LIVE_PERSONAL_ANNUAL",
  live_share_annual: "STRIPE_PRICE_LIVE_SHARE_ANNUAL",
};

function configuredStripePriceId(sku: BillingSku): string | undefined {
  const envKey = STRIPE_PRICE_ENV_BY_SKU[sku];
  return envKey ? process.env[envKey] : undefined;
}

async function getOrCreateStripeCustomer(userId: string, email?: string) {
  const stripe = getStripe();
  const existing = await stripe.customers.search({
    query: `metadata['odesseus_user_id']:'${userId}'`,
    limit: 1,
  });

  if (existing.data[0]) return existing.data[0];

  return stripe.customers.create({
    email,
    metadata: { odesseus_user_id: userId },
  });
}

// Accepts a plain string on purpose: pre-migration UI may still submit legacy
// application-credit SKUs ("app_*"). Any SKU absent from the sellable catalog
// fails closed with an "Invalid product" redirect — nothing can be charged for
// a product that no longer exists.
export async function createCheckoutSession(sku: string) {
  const item = billingCatalog[sku as BillingSku];
  if (!item) redirect("/billing?error=Invalid%20product");

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  const email = typeof auth?.claims?.email === "string" ? auth.claims.email : undefined;

  if (!userId) redirect("/login");

  // Both halves of the billing configuration, not just the site URL: with the
  // site URL set but STRIPE_SECRET_KEY absent, `getStripe()` below throws and
  // the candidate sees a server error rather than the "billing is not
  // configured" they were redirected to expect. A missing key is a deployment
  // state, not a fault in the request.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl || !process.env.STRIPE_SECRET_KEY) redirect("/billing?error=Billing%20is%20not%20configured");

  const interval = recurringIntervalFor(item);
  const stripePriceId = configuredStripePriceId(sku as BillingSku);
  const customer = await getOrCreateStripeCustomer(userId, email);

  const lineItems = stripePriceId
    ? [{ price: stripePriceId, quantity: 1 }]
    : [{
        price_data: {
          currency: "usd",
          unit_amount: item.amountCents,
          product_data: { name: item.label, description: item.description },
          // Local-development fallback when a pre-created Stripe Price ID has
          // not been configured yet.
          ...(interval ? { recurring: { interval } } : {}),
        },
        quantity: 1,
      }];

  const session = await getStripe().checkout.sessions.create({
    mode: interval ? "subscription" : "payment",
    customer: customer.id,
    line_items: lineItems,
    success_url: `${siteUrl}/billing?status=success`,
    cancel_url: `${siteUrl}/billing?status=cancelled`,
    metadata: {
      odesseus_user_id: userId,
      sku,
      credit_type: item.creditType,
      credit_delta: String(item.creditDelta),
      // plan_type is what the fulfillment trigger reads the Live membership
      // configuration from; a subscription carries it on the session too so a
      // replayed webhook resolves the same plan.
      ...("planType" in item ? { plan_type: item.planType } : {}),
    },
  });

  if (!session.url) redirect("/billing?error=Checkout%20could%20not%20start");
  redirect(session.url);
}
