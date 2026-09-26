import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isTrustedOrigin } from "@/lib/security/origin-check";
import { acceptInvitation } from "@/lib/employer/service";

export const runtime = "nodejs";

/**
 * Redeems a team invitation for the signed-in caller.
 *
 * The caller is whoever is signed in; there is no organization in the path,
 * because the invitation token is what identifies the team. The database decides
 * whether the redemption is legitimate — it checks that the token exists, is
 * still pending and unexpired, and that the caller's own verified email is the
 * address that was invited, then takes the org lock and enforces the seat meter.
 * This route only translates the outcome.
 */
export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const token =
    body && typeof body === "object" && "token" in body
      ? String((body as { token: unknown }).token ?? "")
      : "";

  if (token.length > 200) {
    return NextResponse.json({ error: "That invitation link is not valid." }, { status: 400 });
  }

  const result = await acceptInvitation(supabase, token);

  if (result.ok) {
    return NextResponse.json({
      joined: { orgId: result.orgId, orgName: result.orgName, role: result.role },
    });
  }

  switch (result.code) {
    case "no_seats":
      return NextResponse.json(
        {
          error:
            "This team has no recruiter seats left. Ask a team owner or admin to add one.",
        },
        { status: 409 }
      );
    case "invalid":
      return NextResponse.json(
        { error: "That invitation link is no longer valid." },
        { status: 400 }
      );
    default:
      console.error(
        "[ODESSEUS_EMPLOYER_TEAM] invitation accept failed",
        userId
      );
      return NextResponse.json(
        { error: "Could not join that team. Please try again." },
        { status: 500 }
      );
  }
}
