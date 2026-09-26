import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { isTrustedOrigin } from "@/lib/security/origin-check";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { employerFeaturedTiers } from "@/lib/billing/catalog";
import {
  getFeatureableJob,
  isFeaturedTier,
  requireOrgAdmin,
} from "@/lib/employer/service";

export const runtime = "nodejs";

// A featured listing is a real one-time charge, so the per-org purchase rate is
// bounded: an admin should not be able to script a hundred concurrent checkouts
// and leave a pile of half-abandoned sessions behind.
const CHECKOUTS_PER_HOUR = 12;

const schema = z.object({
  jobId: z.string().uuid(),
  tier: z.string(),
});

/**
 * Starts a Stripe checkout for a featured listing on one of the org's own jobs.
 *
 * Featured listings are one-time purchases, not a subscription, so the session
 * is created in `payment` mode. The metadata is exactly what the billing webhook
 * requires to fulfil it: `odesseus_org_id` and `odesseus_job_id` for the
 * entitlement and `odesseus_featured_tier` for the window. The webhook then
 * re-verifies the paid amount against the featured catalog and calls
 * odesseus_create_featured_listing, which re-checks that the job belongs to the
 * paying org and keys the insert on the payment intent so a replayed event
 * cannot create a second listing.
 *
 * The price is derived from the catalog and the tier must be a catalog key, so a
 * client cannot choose what it pays for.
 *
 * No boost is applied here. Visibility only begins once Stripe confirms payment,
 * so an abandoned or failed checkout costs nothing.
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
      { error: "Choose a job and a featured option." },
      { status: 400 }
    );
  }

  if (!isFeaturedTier(input.tier)) {
    return NextResponse.json(
      { error: "Choose a featured option." },
      { status: 400 }
    );
  }

  // Spending money is an admin action. A non-member gets 404 rather than 403 so
  // the endpoint cannot be used to confirm that an org exists.
  let authorization: Awaited<ReturnType<typeof requireOrgAdmin>>;
  try {
    authorization = await requireOrgAdmin(supabase, orgId, userId);
  } catch (error) {
    console.error("[ODESSEUS_EMPLOYER_FEATURED] authorization failed", error);
    return NextResponse.json(
      { error: "Could not check your team permissions." },
      { status: 500 }
    );
  }

  if (!authorization.ok) {
    return authorization.reason === "not_a_member"
      ? NextResponse.json({ error: "That team could not be found." }, { status: 404 })
      : NextResponse.json(
          { error: "Only a team owner or admin can feature a job." },
          { status: 403 }
        );
  }

  // Fail before presenting a card. The webhook re-checks this, so a caller
  // cannot reach the payment step for a job that is not theirs to boost.
  let job: Awaited<ReturnType<typeof getFeatureableJob>>;
  try {
    job = await getFeatureableJob(supabase, orgId, input.jobId);
  } catch (error) {
    console.error("[ODESSEUS_EMPLOYER_FEATURED] job lookup failed", orgId, error);
    return NextResponse.json(
      { error: "Could not check that job." },
      { status: 500 }
    );
  }

  if ("reason" in job) {
    return NextResponse.json(
      {
        error:
          job.reason === "closed"
            ? "That job is closed, so it cannot be featured."
            : "That job could not be found.",
      },
      { status: job.reason === "closed" ? 409 : 404 }
    );
  }

  const rate = checkRateLimit(`employer-featured-checkout:${orgId}`, CHECKOUTS_PER_HOUR, 60 * 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many featured checkouts started. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    return NextResponse.json(
      { error: "Billing is not configured." },
      { status: 503 }
    );
  }

  const tier = input.tier;
  const item = employerFeaturedTiers[tier];

  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: item.amountCents,
          product_data: {
            name: item.label,
            description: item.description,
          },
        },
        quantity: 1,
      },
    ],
    success_url: `${siteUrl}/employer/featured?boost=success`,
    cancel_url: `${siteUrl}/employer/featured?boost=cancelled`,
    // The featured screen re-reads this once Stripe confirms.
    client_reference_id: orgId,
    metadata: {
      odesseus_org_id: orgId,
      odesseus_job_id: input.jobId,
      odesseus_featured_tier: tier,
    },
  });

  if (!session.url) {
    console.error("[ODESSEUS_EMPLOYER_FEATURED] checkout session had no url", orgId);
    return NextResponse.json(
      { error: "Checkout could not start. Please try again." },
      { status: 502 }
    );
  }

  return NextResponse.json({
    url: session.url,
    tier,
    jobId: input.jobId,
    amountCents: item.amountCents,
    days: item.days,
  });
}
