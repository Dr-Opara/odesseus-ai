import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getCallerPricingContext,
  getLocalizedPrices,
  resolvePricingMarket,
} from "@/lib/pricing/service";
import { formatLocaleOrDefault } from "@/lib/pricing/utils";

export const runtime = "nodejs";

/**
 * Public, read-only localized pricing catalog.
 *
 * Resolution is server-side only: an authenticated caller is resolved from
 * their profile country; everyone else deterministically resolves to the
 * USD_US fallback market (approved reference prices). Client-supplied
 * country/currency values are never trusted for payment-priced resolution,
 * and nothing here performs FX conversion.
 *
 * Response contains integer minor-unit amounts plus a ready-to-display
 * formatted price. Stripe identifiers are never included.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const context = await getCallerPricingContext(supabase);
    const resolution = await resolvePricingMarket(supabase, context);
    const locale = formatLocaleOrDefault(context.locale, resolution.market?.locale);

    const prices = await getLocalizedPrices(
      supabase,
      resolution.market,
      locale
    );

    const headers = context.signedIn
      ? { "Cache-Control": "private, no-store" }
      : { "Cache-Control": "public, max-age=300" };

    return NextResponse.json(
      {
        market: resolution.market,
        market_reason: resolution.reason,
        prices,
      },
      { headers }
    );
  } catch {
    return NextResponse.json(
      { error: "Could not load pricing right now." },
      { status: 500 }
    );
  }
}