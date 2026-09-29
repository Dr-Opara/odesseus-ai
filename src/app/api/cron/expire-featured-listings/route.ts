import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/**
 * Expire paid featured listings whose window has passed.
 *
 * The listings UI already filters expired rows, but the stored `is_active`
 * flag is what capacity and analytics read, so a scheduled tick must flip
 * it. Authorized with the CRON_SECRET bearer, same as the other maintenance
 * crons. Bounded by nature (one UPDATE) and idempotent: re-running with
 * nothing expired reports zero.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const service = createServiceClient();
    const { data, error } = await service.rpc("expire_ended_featured_listings");

    if (error) {
      throw new Error(error.message);
    }

    const row = Array.isArray(data) ? data[0] : data;
    const expired =
      row && typeof row === "object" && "expired" in row
        ? Number((row as { expired: number }).expired) || 0
        : 0;

    // Best-effort featured lifecycle notices. Recently-expired listings get
    // one EXPIRED notice each (deduped per listing, so it never repeats);
    // listings entering their final 72 hours get one EXPIRING notice each.
    // A notification failure must never fail the expiry tick itself.
    let expiringNotified = 0;
    let expiredNotified = 0;
    try {
      const { notifyEmployerMembers } = await import("@/lib/notifications/employer");
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 26 * 60 * 60 * 1000).toISOString();
      const threeDays = new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString();

      const { data: listings } = await service
        .from("featured_listings")
        .select("id,org_id,job_id,tier,is_active,expires_at")
        .or(`and(is_active.eq.false,expires_at.gt.${dayAgo}),and(is_active.eq.true,expires_at.lte.${threeDays})`);

      const jobIds = [...new Set(((listings ?? []) as Array<{ job_id: string }>).map((l) => l.job_id))];
      const titles = new Map<string, string>();
      if (jobIds.length > 0) {
        const { data: jobs } = await service
          .from("employer_jobs")
          .select("id,title")
          .in("id", jobIds);
        for (const job of (jobs ?? []) as Array<{ id: string; title: string }>) {
          titles.set(job.id, job.title);
        }
      }

      for (const listing of (listings ?? []) as Array<{
        id: string;
        org_id: string;
        job_id: string;
        tier: string;
        is_active: boolean;
        expires_at: string;
      }>) {
        const jobTitle = titles.get(listing.job_id) ?? "your job";
        const isExpiredNotice = !listing.is_active;
        const notified = await notifyEmployerMembers(
          listing.org_id,
          {
            notification_type: isExpiredNotice
              ? "EMPLOYER_FEATURED_JOB_EXPIRED"
              : "EMPLOYER_FEATURED_JOB_EXPIRING",
            title: isExpiredNotice
              ? `Featured boost ended for ${jobTitle}`
              : `Featured boost for ${jobTitle} ends soon`,
            message: isExpiredNotice
              ? "The paid visibility window has closed."
              : "Renew the boost before the visibility window closes.",
            entity_type: "featured_listing",
            entity_id: listing.id,
            priority: isExpiredNotice ? "normal" : "high",
          },
          {
            dedupeTemplate: `employer:${listing.org_id}:featured:${listing.id}:${
              isExpiredNotice ? "expired" : "expiring"
            }:{user}`,
          }
        );
        if (notified > 0) {
          if (isExpiredNotice) expiredNotified += 1;
          else expiringNotified += 1;
        }
      }
    } catch (notifyError) {
      console.error("[ODESSEUS_FEATURED] lifecycle notices failed", notifyError);
    }

    return NextResponse.json({ ok: true, expired, expiringNotified, expiredNotified });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_FEATURED] expiry tick failed", message);
    return NextResponse.json({ error: "Featured expiry tick failed." }, { status: 500 });
  }
}
