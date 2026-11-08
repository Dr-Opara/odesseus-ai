import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Inbox and calendar reading is retired: Odesseus does not read candidate
 * email or calendars, and does not auto-detect interviews. Candidates return
 * to Odesseus themselves when they are invited to interview.
 * `/api/integrations/google/disconnect` stays live so existing connections
 * can still be revoked.
 */
export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/integrations/google", request.url), 303);
}
