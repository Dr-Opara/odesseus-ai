import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { isTrustedOrigin } from "@/lib/security/origin-check";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { employerRecruiterSeat } from "@/lib/billing/catalog";
import {
  SEATS_PER_CHECKOUT_MAX,
  SEATS_PER_CHECKOUT_MIN,
  requireOrgAdmin,
} from "@/lib/employer/service";

export const runtime = "nodejs";

// A seat is a real monthly charge, so the quantity is bounded and the per-org
// checkout rate is limited: an admin should not be able to script a hundred
// concurrent seat checkouts.
const CHECKOUTS_PER_HOUR = 12;

const schema = z.object({
  seatCount: z
    .number()
    .int()
    .min(SEATS_PER_CHECKOUT_MIN)
    .max(SEATS_PER_CHECKOUT_MAX),
});

/**
 * Starts a Stripe subscription checkout for N additional recruiter seats.
 *
 * The seat product is recurring and seat-counted, so the session is created in
 * `subscription` mode with a quantity line rather than a one-time payment. The
 * metadata is exactly what the billing webhook requires to fulfil the purchase:
 * `odesseus_org_id` for the entitlement, `odesseus_recruiter_seats` as the
 * marker that distinguishes a seat subscription from a plan subscription, and
 * `odesseus_seat_count` for the quantity the webhook then price-verifies
 * (seatCount x $20.00) before it calls `odesseus_sync_recruiter_seat`.
 *
 * No seat is granted here. Capacity only changes when the webhook confirms a
 * paid invoice, and a cancelled or past-due subscription stops counting
 * immediately.
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
      { error: "Choose how many seats you need." },
      { status: 400 }
    );
  }

  // Only an org owner or admin may buy seats. A non-member gets 404 rather than
  // 403 so the endpoint cannot be used to confirm that an org exists.
  let authorization: Awaited<ReturnType<typeof requireOrgAdmin>>;
  try {
    authorization = await requireOrgAdmin(supabase, orgId, userId);
  } catch (error) {
    console.error("[ODESSEUS_EMPLOYER_SEATS] authorization failed", error);
    return NextResponse.json(
      { error: "Could not check your team permissions." },
      { status: 500 }
    );
  }

  if (!authorization.ok) {
    return authorization.reason === "not_a_member"
      ? NextResponse.json({ error: "That team could not be found." }, { status: 404 })
      : NextResponse.json(
          { error: "Only a team owner or admin can add seats." },
          { status: 403 }
        );
  }

  const rate = checkRateLimit(`employer-seat-checkout:${orgId}`, CHECKOUTS_PER_HOUR, 60 * 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many seat checkouts started. Please try again later." },
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

  // The amount is derived from the catalog, never from the request, so a client
  // cannot choose what it pays. The webhook independently re-verifies the same
  // figure before granting seats.
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: employerRecruiterSeat.amountCents,
          recurring: { interval: "month" },
          product_data: {
            name: employerRecruiterSeat.label,
            description: employerRecruiterSeat.description,
          },
        },
        quantity: input.seatCount,
      },
    ],
    success_url: `${siteUrl}/employer/team?seats=success`,
    cancel_url: `${siteUrl}/employer/team?seats=cancelled`,
    // The team screen polls this to show the seat count once Stripe confirms.
    client_reference_id: orgId,
    metadata: {
      odesseus_org_id: orgId,
      odesseus_recruiter_seats: "true",
      odesseus_seat_count: String(input.seatCount),
    },
  });

  if (!session.url) {
    console.error("[ODESSEUS_EMPLOYER_SEATS] checkout session had no url", orgId);
    return NextResponse.json(
      { error: "Checkout could not start. Please try again." },
      { status: 502 }
    );
  }

  return NextResponse.json({ url: session.url, seatCount: input.seatCount });
}
