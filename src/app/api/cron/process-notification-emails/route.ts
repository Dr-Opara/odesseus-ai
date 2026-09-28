import { NextResponse } from "next/server";
import { deliverPendingNotificationEmails } from "@/lib/notifications/email";

export const runtime = "nodejs";

/**
 * Drains the notification email backlog: for each row at email_delivery_status
 * = 'none' it decides whether an email is wanted (type email-capable and the
 * recipient's email switch on), enqueues an `email_delivery` retry job with a
 * deterministic idempotency key, and advances the row. Never touches the email
 * provider directly — the retry queue owns sending, so a provider outage can
 * only ever delay an email, never break a business transaction.
 *
 * Authorized with the CRON_SECRET bearer, same as the other maintenance crons.
 * Bounded per tick (default 50 rows); leftovers are picked up next tick.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await deliverPendingNotificationEmails();
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_NOTIFICATION_EMAIL] cron tick failed", message);
    return NextResponse.json({ error: "Notification email dispatch failed." }, { status: 500 });
  }
}