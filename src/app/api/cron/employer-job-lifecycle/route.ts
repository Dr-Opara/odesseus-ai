import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 300;

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_LEAD_DAYS = 5;

function siteUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  return base ? `${base.replace(/\/$/, "")}${path}` : path;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Hourly employer job-post lifecycle.
 *
 * 1. Expiry + auto-renew: every Active or Paused post whose 30-day window has
 *    ended is expired. Active posts with auto-renew on consume a credit and
 *    relaunch for a fresh 30 days; without a credit they expire and the team
 *    is told to buy one or renew.
 * 2. Email 2 — "Your job post for [Job Title] has expired – Reactivate now?"
 * 3. Email 1 — 5 days before a cycle's unused base credits expire.
 * 4. Email 3 — 5 days before an individual add-on credit expires.
 *
 * Authorized with the CRON_SECRET bearer, like every maintenance cron. Each
 * notice is deduplicated per job window / per credit grant, so a missed or
 * repeated tick never double-sends.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const summary = { expired: 0, renewed: 0, renewalFailed: 0, expiryNotices: 0, baseReminders: 0, addonReminders: 0 };

  try {
    const { data, error } = await service.rpc("odesseus_process_expired_employer_jobs", { p_limit: 500 });
    if (error) throw new Error(error.message);

    const { notifyEmployerMembers } = await import("@/lib/notifications/employer");
    for (const row of data ?? []) {
      if (row.outcome === "renewed") {
        summary.renewed += 1;
        continue;
      }
      if (row.outcome === "renewal_failed") summary.renewalFailed += 1;
      else summary.expired += 1;

      const notified = await notifyEmployerMembers(
        row.org_id,
        {
          notification_type: "EMPLOYER_JOB_POST_EXPIRED",
          title: `Your job post for ${row.title} has expired – Reactivate now?`,
          message:
            (row.outcome === "renewal_failed"
              ? "Auto-renew was on, but there was no job-post credit available, so the listing has ended. "
              : "Your 30-day listing has ended and is no longer visible to candidates. ") +
            "Your applicant data is still saved. Repost it with a credit to start a new 30-day window.",
          entity_type: "employer_job",
          entity_id: row.job_id,
          action_url: siteUrl(`/employers/jobs/${row.job_id}`),
          priority: "high",
          metadata: { outcome: row.outcome, expired_at: row.expires_at },
        },
        { dedupeTemplate: `employer:${row.org_id}:job:${row.job_id}:expired:${row.expires_at}:{user}` }
      );
      if (notified > 0) summary.expiryNotices += 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_JOBS] expiry tick failed", message);
    return NextResponse.json({ error: "Employer job expiry tick failed." }, { status: 500 });
  }

  // Credit-expiry reminders are best-effort: a failure here never fails the
  // expiry work above.
  try {
    const { notifyEmployerMembers } = await import("@/lib/notifications/employer");
    const now = Date.now();
    const windowStart = new Date(now + (REMINDER_LEAD_DAYS - 1) * DAY_MS).toISOString();
    const windowEnd = new Date(now + REMINDER_LEAD_DAYS * DAY_MS).toISOString();

    const { data: credits } = await service
      .from("employer_job_post_credits")
      .select("id,org_id,total,used,kind,granted_at,expires_at")
      .gt("expires_at", windowStart)
      .lte("expires_at", windowEnd);

    const unused = (credits ?? []).filter((credit) => credit.used < credit.total && credit.expires_at);
    const orgIds = [...new Set(unused.map((credit) => credit.org_id))];
    const names = new Map<string, string>();
    if (orgIds.length > 0) {
      const { data: orgs } = await service.from("employer_organizations").select("id,name").in("id", orgIds);
      for (const org of orgs ?? []) names.set(org.id, org.name);
    }

    for (const credit of unused) {
      const remaining = credit.total - credit.used;
      const expiresAt = credit.expires_at as string;
      const company = names.get(credit.org_id) ?? "your company";

      if (credit.kind === "addon") {
        const notified = await notifyEmployerMembers(
          credit.org_id,
          {
            notification_type: "EMPLOYER_ADDON_CREDIT_EXPIRING",
            title: "Quick Heads Up: Your add-on job credit expires in 5 days",
            message: `${remaining} add-on job-post ${remaining === 1 ? "credit" : "credits"} bought ${formatDate(
              credit.granted_at
            )} ${remaining === 1 ? "expires" : "expire"} on ${formatDate(expiresAt)}. Post a job before then so it isn't lost.`,
            entity_type: "employer_organization",
            entity_id: credit.org_id,
            action_url: siteUrl("/employers/post-job"),
            priority: "normal",
            metadata: { credit_id: credit.id, remaining, purchased_at: credit.granted_at, expires_at: expiresAt },
          },
          { dedupeTemplate: `employer:${credit.org_id}:addon-credit:${credit.id}:expiring:{user}` }
        );
        if (notified > 0) summary.addonReminders += 1;
      } else {
        const notified = await notifyEmployerMembers(
          credit.org_id,
          {
            notification_type: "EMPLOYER_BASE_CREDITS_EXPIRING",
            title: `Don't let your ${company} job credits go to waste!`,
            message: `You have ${remaining} unused job-post ${remaining === 1 ? "credit" : "credits"} in this billing cycle. They expire on ${formatDate(
              expiresAt
            )} and don't roll over. Post your open roles now.`,
            entity_type: "employer_organization",
            entity_id: credit.org_id,
            action_url: siteUrl("/employers/post-job"),
            priority: "high",
            metadata: { credit_id: credit.id, remaining, expires_at: expiresAt },
          },
          { dedupeTemplate: `employer:${credit.org_id}:base-credits:${credit.id}:expiring:{user}` }
        );
        if (notified > 0) summary.baseReminders += 1;
      }
    }
  } catch (error) {
    console.error("[ODESSEUS_EMPLOYER_JOBS] credit reminders failed", error);
  }

  return NextResponse.json({ ok: true, ...summary });
}
