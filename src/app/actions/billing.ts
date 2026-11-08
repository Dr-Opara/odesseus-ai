"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { billingCatalog, type BillingSku } from "@/lib/billing/catalog";

// Every candidate SKU is a one-time purchase: there is no required
// subscription. Optional pre-created Stripe Price IDs; without one, checkout
// uses inline price_data at the catalog amount.
const STRIPE_PRICE_ENV_BY_SKU: Partial<Record<BillingSku, string>> = {
  app_1: "STRIPE_PRICE_APP_1",
  app_25: "STRIPE_PRICE_APP_25",
  app_50: "STRIPE_PRICE_APP_50",
  app_100: "STRIPE_PRICE_APP_100",
  interview_1: "STRIPE_PRICE_LIVE_1",
  interview_3: "STRIPE_PRICE_LIVE_3",
  interview_annual: "STRIPE_PRICE_LIVE_ANNUAL",
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

// Accepts a plain string on purpose: stale UI may still submit retired SKUs
// (wallet_*, live_monthly, ...). Any SKU absent from the sellable catalog
// fails closed with an "Invalid product" redirect — nothing can be charged for
// a product that is no longer sold.
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

  const stripePriceId = configuredStripePriceId(sku as BillingSku);
  const customer = await getOrCreateStripeCustomer(userId, email);

  const lineItems = stripePriceId
    ? [{ price: stripePriceId, quantity: 1 }]
    : [{
        price_data: {
          currency: "usd",
          unit_amount: item.amountCents,
          // Fallback when a pre-created Stripe Price ID is not configured.
          product_data: { name: item.label, description: item.description },
        },
        quantity: 1,
      }];

  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    customer: customer.id,
    line_items: lineItems,
    success_url: `${siteUrl}/billing?status=success`,
    cancel_url: `${siteUrl}/billing?status=cancelled`,
    metadata: {
      odesseus_user_id: userId,
      sku,
      credit_type: item.creditType,
      credit_delta: String(item.creditDelta),
    },
  });

  if (!session.url) redirect("/billing?error=Checkout%20could%20not%20start");
  redirect(session.url);
}
