import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getStripe } from "@/lib/stripe";
import { isTrustedOrigin } from "@/lib/security/origin-check";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { employerAddonPost } from "@/lib/billing/catalog";
import { requireOrgAdmin } from "@/lib/employer/service";

export const runtime = "nodejs";

const CHECKOUTS_PER_HOUR = 20;

const schema = z.object({
  quantity: z.number().int().min(1).max(employerAddonPost.maxQuantity),
});

/**
 * Starts a one-time Stripe checkout for additional job posts ($10 USD each).
 *
 * The $10 rate is only available while the org has an active AI Starter
 * Bundle. Each purchased credit expires 30 days after purchase, independent of
 * the bundle's billing cycle. The amount comes from the catalog, never from the
 * request; the webhook re-verifies quantity x $10 before granting anything.
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
      { error: `Choose between 1 and ${employerAddonPost.maxQuantity} additional job posts.` },
      { status: 400 }
    );
  }

  let authorization: Awaited<ReturnType<typeof requireOrgAdmin>>;
  try {
    authorization = await requireOrgAdmin(supabase, orgId, userId);
  } catch (error) {
    console.error("[ODESSEUS_EMPLOYER_ADDONS] authorization failed", error);
    return NextResponse.json({ error: "Could not check your team permissions." }, { status: 500 });
  }
  if (!authorization.ok) {
    return authorization.reason === "not_a_member"
      ? NextResponse.json({ error: "That team could not be found." }, { status: 404 })
      : NextResponse.json(
          { error: "Only a team owner or admin can buy job posts." },
          { status: 403 }
        );
  }

  const rate = checkRateLimit(`employer-addon-checkout:${orgId}`, CHECKOUTS_PER_HOUR, 60 * 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many checkouts started. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl || !process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }

  const service = createServiceClient();
  const { data: canBuy, error: eligibilityError } = await service.rpc(
    "odesseus_employer_can_buy_addons",
    { p_org_id: orgId }
  );
  if (eligibilityError) {
    console.error("[ODESSEUS_EMPLOYER_ADDONS] eligibility check failed", eligibilityError);
    return NextResponse.json({ error: "Could not check your plan." }, { status: 500 });
  }
  if (canBuy !== true) {
    return NextResponse.json(
      {
        error:
          "Additional job posts at $10 are available only with an active AI Starter Bundle. Renew your bundle to buy more.",
        reason: "bundle_inactive",
      },
      { status: 409 }
    );
  }

  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: employerAddonPost.amountCents,
          product_data: {
            name: employerAddonPost.label,
            description: employerAddonPost.description,
          },
        },
        quantity: input.quantity,
      },
    ],
    success_url: `${siteUrl}/employers/dashboard/billing?addons=success`,
    cancel_url: `${siteUrl}/employers/dashboard/billing?addons=cancelled`,
    client_reference_id: orgId,
    metadata: {
      odesseus_org_id: orgId,
      odesseus_employer_addon: "true",
      odesseus_addon_quantity: String(input.quantity),
    },
  });

  if (!session.url) {
    console.error("[ODESSEUS_EMPLOYER_ADDONS] checkout session had no url", orgId);
    return NextResponse.json({ error: "Checkout could not start. Please try again." }, { status: 502 });
  }

  return NextResponse.json({ url: session.url, quantity: input.quantity });
}
