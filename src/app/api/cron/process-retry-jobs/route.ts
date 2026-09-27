import { NextResponse } from "next/server";
import { claimRetryJob, completeRetryJob } from "@/lib/retry/service";
import { runRetryHandler } from "@/lib/retry/handlers";
import { RETRY_JOB_TYPES } from "@/lib/retry/job-types";

/**
 * Drains the `retry_jobs` queue: claims due jobs of every registered type,
 * re-executes each via its idempotent handler, and marks the outcome. A
 * job that keeps failing past its max attempts becomes `dead_letter` (set
 * by `odesseus_complete_retry_job`) — queryable for manual follow-up
 * instead of a silently repeated failure.
 *
 * Bounded per job type per invocation so one cron tick cannot run
 * indefinitely; anything left over is picked up on the next tick.
 */
const MAX_CLAIMS_PER_TYPE = 25;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary: Record<string, { succeeded: number; failed: number; deadLettered: number }> = {};

  for (const jobType of RETRY_JOB_TYPES) {
    const counts = { succeeded: 0, failed: 0, deadLettered: 0 };
    summary[jobType] = counts;

    for (let i = 0; i < MAX_CLAIMS_PER_TYPE; i += 1) {
      const job = await claimRetryJob(jobType);
      if (!job) break;

      try {
        await runRetryHandler(job.jobType, job.payload);
        await completeRetryJob(job.id, "succeeded");
        counts.succeeded += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await completeRetryJob(job.id, "failed", message);
        counts.failed += 1;
        if (job.attempts >= job.maxAttempts) counts.deadLettered += 1;
        console.error(`[ODESSEUS_RETRY] ${jobType} job ${job.id} failed`, message);
      }
    }
  }

  return NextResponse.json({ ok: true, processed: summary });
}
