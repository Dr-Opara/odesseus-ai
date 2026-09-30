import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { isTrustedOrigin } from "@/lib/security/origin-check";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { employerPlans, type EmployerPlanSku } from "@/lib/billing/catalog";
import { requireOrgAdmin } from "@/lib/employer/service";
import type { EmployerTier } from "@/lib/employer/plans";

export const runtime = "nodejs";

// A plan is a real monthly charge; bound the per-org checkout rate so an
// admin cannot script concurrent subscription checkouts.
const CHECKOUTS_PER_HOUR = 12;

const TIER_TO_SKU: Record<EmployerTier, EmployerPlanSku> = {
  starter: "employer_starter",
  growth: "employer_growth",
  business: "employer_business",
};

const schema = z.object({
  tier: z.enum(["starter", "growth", "business"]),
});

/**
 * Starts a Stripe subscription checkout for an employer plan tier.
 *
 * The amount comes from the billing catalog, never from the request, and
 * the webhook independently re-verifies the paid invoice amount against the
 * same catalog before granting the cycle's job-post credits. Metadata
 * carries exactly what fulfillment needs: `odesseus_org_id` (which org) and
 * `odesseus_tier` (creation-time hint; the charged amount stays authoritative
 * across later upgrades/downgrades).
 *
 * Nothing is granted here. The subscription row and its job-post credits
 * appear only when the webhook confirms a paid invoice.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  if (!isTrustedOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const { orgId } = await params;
  if (!z.string().uuid().safeParse(orgId).success) {
    return NextResponse.json({ error: "That team could not be found." }, { status: 404 });
  }

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Choose a plan: Starter, Growth, or Business." },
      { status: 400 }
    );
  }

  // Only an org owner or admin may buy the plan. A non-member gets 404
  // rather than 403 so the endpoint cannot confirm that an org exists.
  let authorization: Awaited<ReturnType<typeof requireOrgAdmin>>;
  try {
    authorization = await requireOrgAdmin(supabase, orgId, userId);
  } catch (error) {
    console.error("[ODESSEUS_EMPLOYER_PLANS] authorization failed", error);
    return NextResponse.json(
      { error: "Could not check your team permissions." },
      { status: 500 }
    );
  }

  if (!authorization.ok) {
    return authorization.reason === "not_a_member"
      ? NextResponse.json({ error: "That team could not be found." }, { status: 404 })
      : NextResponse.json(
          { error: "Only a team owner or admin can change the plan." },
          { status: 403 }
        );
  }

  const rate = checkRateLimit(`employer-plan-checkout:${orgId}`, CHECKOUTS_PER_HOUR, 60 * 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many plan checkouts started. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
    );
  }

  // The whole billing configuration, not just the site URL. Checking
  // NEXT_PUBLIC_SITE_URL alone was checking the wrong variable: with the site
  // URL set but STRIPE_SECRET_KEY absent, `getStripe()` below throws and the
  // caller gets a 500 from an unhandled configuration error, where the route
  // clearly meant to answer 503. A missing key is a deployment state, not a
  // fault in the request, and it should be reported as one.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl || !process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: "Billing is not configured." },
      { status: 503 }
    );
  }

  const plan = employerPlans[TIER_TO_SKU[input.tier]];
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: plan.amountCents,
          recurring: { interval: "month" },
          product_data: {
            name: plan.label,
            description: plan.description,
          },
        },
        quantity: 1,
      },
    ],
    success_url: `${siteUrl}/employers/dashboard/billing?plan=success`,
    cancel_url: `${siteUrl}/employers/dashboard/billing?plan=cancelled`,
    client_reference_id: orgId,
    metadata: {
      odesseus_org_id: orgId,
      odesseus_tier: plan.tier,
    },
  });

  if (!session.url) {
    console.error("[ODESSEUS_EMPLOYER_PLANS] checkout session had no url", orgId);
    return NextResponse.json(
      { error: "Checkout could not start. Please try again." },
      { status: 502 }
    );
  }

  return NextResponse.json({ url: session.url, tier: plan.tier });
}
