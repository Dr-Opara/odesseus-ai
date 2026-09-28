import { NextResponse } from "next/server";
import { fireDueInterviewReminders } from "@/lib/notifications/reminders";

export const runtime = "nodejs";

/**
 * Fires due interview reminders: materialized reminder rows (1 day / 1 hour
 * before the interview) whose due_at has passed are turned into
 * INTERVIEW_REMINDER notifications (channel-gated, deduped per interview +
 * window) and marked fired. Cancelled/completed interviews cancel their
 * reminders defensively.
 *
 * Authorized with the CRON_SECRET bearer, same as the other maintenance crons.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await fireDueInterviewReminders();
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_REMINDERS] cron tick failed", message);
    return NextResponse.json({ error: "Interview reminder firing failed." }, { status: 500 });
  }
}