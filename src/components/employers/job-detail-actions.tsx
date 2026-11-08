"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  setJobAutoRenewAction,
  transitionJobAction,
  type JobTransition,
} from "@/lib/employers/actions";
import EmployerStatePanel from "@/components/employers/state-panel";
import { AUTO_RENEW_LABEL, CLOSE_TOOLTIP, PAUSE_TOOLTIP } from "@/lib/employer/plans";
import type { EmployerJobDetail } from "@/lib/employers/types";

/**
 * Job Detail actions (F13-D) and the job-post lifecycle.
 *
 * Each transition goes to the jobs route, which enforces the real rules:
 *  - Publish (draft) and Repost (expired) each use one job-post credit and
 *    start a fresh 30-day window.
 *  - Pause hides an active post but its original 30-day window keeps running.
 *  - Reactivate is free while that window is still open.
 *  - Mark as Filled / Close Job end the listing permanently; the credit is not
 *    refunded.
 * The refusal is shown as the route stated it, and the page is re-read so the
 * rendered status is the persisted one.
 */
export default function JobDetailActions({
  job,
  orgId,
}: {
  job: EmployerJobDetail;
  orgId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<JobTransition | "auto_renew" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const windowOpen = job.expiresAt ? new Date(job.expiresAt) > new Date() : false;

  async function run(transition: JobTransition) {
    if (
      (transition === "close" || transition === "close_filled") &&
      !window.confirm(CLOSE_TOOLTIP)
    ) {
      return;
    }
    setPending(transition);
    setFailure(null);
    const result = await transitionJobAction(orgId, job.id, transition);
    setPending(null);

    if (result.status === "unavailable") {
      setFailure(result.reason);
      return;
    }

    if (transition === "delete") {
      router.push("/employers/dashboard/jobs");
      return;
    }
    router.refresh();
  }

  async function toggleAutoRenew(enabled: boolean) {
    setPending("auto_renew");
    setFailure(null);
    const result = await setJobAutoRenewAction(orgId, job.id, enabled);
    setPending(null);
    if (result.status === "unavailable") {
      setFailure(result.reason);
      return;
    }
    router.refresh();
  }

  const button = (transition: JobTransition, label: string, busy: string, options?: { danger?: boolean; title?: string }) => (
    <button
      type="button"
      className={`emp-btn-secondary${options?.danger ? " is-danger" : ""}`}
      onClick={() => run(transition)}
      disabled={pending !== null}
      title={options?.title}
    >
      {pending === transition ? busy : label}
    </button>
  );

  return (
    <div style={{ marginTop: 24 }}>
      {job.expiresAt && (job.status === "Published" || job.status === "Paused") ? (
        <p className="muted" style={{ margin: "0 0 12px", fontSize: 14 }}>
          This post&rsquo;s 30-day window ends {new Date(job.expiresAt).toLocaleString()}.
        </p>
      ) : null}

      <div className="emp-page-actions">
        <Link href={`/employers/candidates?job=${job.id}`} className="figma-btn figma-btn-orange">
          View Applicants
        </Link>
        <Link href={`/employers/pipeline?job=${job.id}`} className="emp-btn-secondary">
          View Pipeline
        </Link>

        {job.status === "Draft" ? (
          <>
            <Link href={`/employers/jobs/${job.id}/edit`} className="emp-btn-secondary">
              Edit Job
            </Link>
            {button("publish", "Publish · uses 1 credit", "Publishing…")}
            {button("delete", "Delete draft", "Deleting…", { danger: true })}
          </>
        ) : null}

        {job.status === "Published" ? (
          <>
            {button("pause", "Pause", "Pausing…", { title: PAUSE_TOOLTIP })}
            {button("close_filled", "Mark as Filled", "Closing…", { title: CLOSE_TOOLTIP })}
            {button("close", "Close Job", "Closing…", { danger: true, title: CLOSE_TOOLTIP })}
          </>
        ) : null}

        {job.status === "Paused" ? (
          <>
            {windowOpen
              ? button("resume", "Reactivate · free", "Reactivating…")
              : null}
            {button("close_filled", "Mark as Filled", "Closing…", { title: CLOSE_TOOLTIP })}
            {button("close", "Close Job", "Closing…", { danger: true, title: CLOSE_TOOLTIP })}
          </>
        ) : null}

        {job.status === "Expired" ? (
          <>
            {button("repost", "Repost · uses 1 credit", "Reposting…")}
            {button("close", "Close Job", "Closing…", { danger: true, title: CLOSE_TOOLTIP })}
          </>
        ) : null}

        {job.status === "Published" || job.status === "Paused" ? (
          <Link href={`/employers/jobs/${job.id}/feature`} className="emp-btn-secondary">
            Feature this Job
          </Link>
        ) : null}
      </div>

      {job.status === "Published" || job.status === "Paused" ? (
        <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>{PAUSE_TOOLTIP}</p>
      ) : null}

      {job.status !== "Closed" ? (
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 14, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={Boolean(job.autoRenew)}
            disabled={pending !== null}
            onChange={(event) => toggleAutoRenew(event.target.checked)}
          />
          <span>{AUTO_RENEW_LABEL}</span>
        </label>
      ) : null}

      {failure ? (
        <div style={{ marginTop: 16 }}>
          <EmployerStatePanel kind="error" title="Couldn&rsquo;t complete that action" message={failure} />
        </div>
      ) : null}
    </div>
  );
}
