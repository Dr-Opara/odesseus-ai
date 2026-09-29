"use client";

import { useState } from "react";
import Link from "next/link";
import { publishEmployerJob, closeEmployerJob } from "@/lib/employers/jobs-adapter";
import EmployerStatePanel from "@/components/employers/state-panel";
import type { EmployerJobDetail } from "@/lib/employers/types";

/**
 * Job Detail actions (F13-D): View Applicants, Edit, Publish/Close, Feature.
 * Publish/Close call the honest-stub adapter — no optimistic success is
 * shown before the backend confirms it.
 */
export default function JobDetailActions({ job }: { job: EmployerJobDetail }) {
  const [pending, setPending] = useState<"publish" | "close" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function handlePublish() {
    setPending("publish");
    setFailure(null);
    const result = await publishEmployerJob(job.id);
    setPending(null);
    if (result.status === "unavailable") setFailure(result.reason);
  }

  async function handleClose() {
    setPending("close");
    setFailure(null);
    const result = await closeEmployerJob(job.id);
    setPending(null);
    if (result.status === "unavailable") setFailure(result.reason);
  }

  return (
    <div style={{ marginTop: 24 }}>
      <div className="emp-page-actions">
        <Link href={`/employers/candidates?job=${job.id}`} className="figma-btn figma-btn-orange">
          View Applicants
        </Link>
        <Link href={`/employers/pipeline?job=${job.id}`} className="emp-btn-secondary">
          View Pipeline
        </Link>
        <Link href={`/employers/jobs/${job.id}/edit`} className="emp-btn-secondary">
          Edit Job
        </Link>
        {job.status !== "Published" ? (
          <button type="button" className="emp-btn-secondary" onClick={handlePublish} disabled={pending === "publish"}>
            {pending === "publish" ? "Publishing…" : "Publish"}
          </button>
        ) : (
          <button type="button" className="emp-btn-secondary is-danger" onClick={handleClose} disabled={pending === "close"}>
            {pending === "close" ? "Closing…" : "Close Job"}
          </button>
        )}
        <Link href={`/employers/jobs/${job.id}/feature`} className="emp-btn-secondary">
          Feature this Job
        </Link>
      </div>
      {failure ? (
        <div style={{ marginTop: 16 }}>
          <EmployerStatePanel kind="error" title="Couldn't complete that action" message={failure} />
        </div>
      ) : null}
    </div>
  );
}
