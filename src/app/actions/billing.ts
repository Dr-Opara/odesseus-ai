"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { billingCatalog, type BillingSku } from "@/lib/billing/catalog";

export async function createCheckoutSession(sku: BillingSku) {
  const item = billingCatalog[sku];
  if (!item) redirect("/billing?error=Invalid%20product");

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  const email = typeof auth?.claims?.email === "string" ? auth.claims.email : undefined;

  if (!userId) redirect("/login");

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) redirect("/billing?error=Billing%20is%20not%20configured");

  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    customer_email: email,
    line_items: [{
      price_data: {
        currency: "usd",
        unit_amount: item.amountCents,
        product_data: { name: item.label, description: item.description },
      },
      quantity: 1,
    }],
    success_url: `${siteUrl}/billing?status=success`,
    cancel_url: `${siteUrl}/billing?status=cancelled`,
    metadata: {
      odysseus_user_id: userId,
      sku,
      credit_type: item.creditType,
      credit_delta: String(item.creditDelta),
    },
  });

  if (!session.url) redirect("/billing?error=Checkout%20could%20not%20start");
  redirect(session.url);
}
