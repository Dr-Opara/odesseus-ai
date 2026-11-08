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
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, retired: true, synced: 0, failed: 0 });
}
