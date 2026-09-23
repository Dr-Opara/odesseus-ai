import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getCallerPricingContext,
  getLocalizedPrice,
  resolvePricingMarket,
} from "@/lib/pricing/service";
import { PRODUCT_KEY_PATTERN } from "@/lib/pricing/config";
import { formatLocaleOrDefault } from "@/lib/pricing/utils";

export const runtime = "nodejs";

/**
 * Localized price for a single canonical product key, resolved server-side
 * for the caller's market (profile country, or the USD_US fallback for
 * visitors). Unknown or malformed keys answer 404; a product that exists but
 * is not currently sold returns `available: false` rather than a price.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ productKey: string }> }
) {
  try {
    const { productKey } = await params;

    if (!PRODUCT_KEY_PATTERN.test(productKey)) {
      return NextResponse.json(
        { error: "That product could not be found." },
        { status: 404 }
      );
    }

    const supabase = await createClient();
    const context = await getCallerPricingContext(supabase);
    const resolution = await resolvePricingMarket(supabase, context);
    const locale = formatLocaleOrDefault(context.locale, resolution.market?.locale);

    const price = await getLocalizedPrice(
      supabase,
      productKey,
      resolution.market,
      locale
    );

    if (!price) {
      return NextResponse.json(
        { error: "That product could not be found." },
        { status: 404 }
      );
    }

    const headers = context.signedIn
      ? { "Cache-Control": "private, no-store" }
      : { "Cache-Control": "public, max-age=300" };

    return NextResponse.json(
      {
        market: resolution.market,
        market_reason: resolution.reason,
        price,
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