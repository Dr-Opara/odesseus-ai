import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCandidateDashboard } from "@/lib/candidate/dashboard";

/**
 * The candidate dashboard, as one response.
 *
 * This exists so the dashboard has a single, typed, server-computed answer
 * rather than a page that issues a handful of reads and counts the rows it
 * happens to get back. Every number in the payload is counted in the database
 * over every matching row; the only limits applied are to the short lists of
 * recent applications, upcoming interviews and the activity feed, and those
 * limits never affect a count.
 *
 * Authorization is by session only. There is no user id in the path or the
 * query string, so there is nothing for a caller to substitute: the subject is
 * read from the verified JWT claim and passed to the service, which scopes
 * every read to it. The counts RPC independently re-checks that the caller is
 * asking about itself, so a bug in this route cannot become a cross-tenant read.
 *
 * The payload contains no mailbox data. It is built from Odesseus's own tables
 * only, so the response is identical for a candidate with and without a
 * connected email account.
 */

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  try {
    const dashboard = await getCandidateDashboard(supabase, userId);
    return NextResponse.json(dashboard);
  } catch (error) {
    // The message is logged rather than returned. A dashboard read that fails
    // should say "we could not load this" and not hand a caller a description
    // of which table or column misbehaved.
    console.error("[ODESSEUS_DASHBOARD] aggregation failed", error);
    return NextResponse.json(
      { error: "Odesseus could not load your dashboard." },
      { status: 500 }
    );
  }
}
