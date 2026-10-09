import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const CANDIDATE_WALLET_SKUS = new Set(["wallet_10", "wallet_20", "wallet_50"]);
const EMPLOYER_PLANS = new Set(["starter", "growth", "business"]);
const PROMOTION_TIERS = new Set(["featured_7d", "featured_14d", "ai_30d"]);

/**
 * Auth-aware public pricing gateway.
 *
 * Public pricing cards always point here so desktop and mobile use the same
 * behavior. The gateway never grants an entitlement and never trusts a price
 * from the URL. It only decides which existing authenticated purchase surface
 * the user should enter.
 */
export async function GET(request: NextRequest) {
  const audience = request.nextUrl.searchParams.get("audience");
  const action = request.nextUrl.searchParams.get("action");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub ?? null;

  if (audience === "employer") {
    if (!userId) {
      return NextResponse.redirect(new URL("/employers/signup", request.url));
    }

    const { data: membership } = await supabase
      .from("employer_members")
      .select("org_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    // A signed-in candidate is still not an employer account. Send them to the
    // employer onboarding surface instead of exposing an org billing route they
    // cannot use.
    if (!membership?.org_id) {
      return NextResponse.redirect(new URL("/employers/signup", request.url));
    }

    if (action === "plan") {
      const plan = request.nextUrl.searchParams.get("plan");
      const destination = new URL("/employers/dashboard/billing", request.url);
      if (plan && EMPLOYER_PLANS.has(plan)) {
        destination.searchParams.set("purchase", "plan");
        destination.searchParams.set("plan", plan);
      }
      return NextResponse.redirect(destination);
    }

    if (action === "seat") {
      const destination = new URL("/employers/dashboard/billing", request.url);
      destination.searchParams.set("purchase", "seat");
      return NextResponse.redirect(destination);
    }

    if (action === "promotion") {
      const tier = request.nextUrl.searchParams.get("tier");
      const destination = new URL("/employers/dashboard/jobs", request.url);
      destination.searchParams.set("purchase", "promotion");
      if (tier && PROMOTION_TIERS.has(tier)) destination.searchParams.set("tier", tier);
      return NextResponse.redirect(destination);
    }

    return NextResponse.redirect(new URL("/employers/dashboard", request.url));
  }

  if (!userId) {
    return NextResponse.redirect(new URL("/signup", request.url));
  }

  if (action === "wallet") {
    const sku = request.nextUrl.searchParams.get("sku");
    const destination = new URL("/billing", request.url);
    if (sku && CANDIDATE_WALLET_SKUS.has(sku)) {
      destination.searchParams.set("purchase", sku);
    }
    destination.hash = "wallet-topups";
    return NextResponse.redirect(destination);
  }

  if (action === "apply") {
    const destination = new URL("/billing", request.url);
    destination.hash = "wallet-topups";
    return NextResponse.redirect(destination);
  }

  return NextResponse.redirect(new URL("/dashboard", request.url));
}
