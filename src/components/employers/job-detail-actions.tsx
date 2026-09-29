"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { closeEmployerJob, deleteEmployerJobDraft, publishEmployerJob } from "@/lib/employers/jobs-adapter";
import EmployerStatePanel from "@/components/employers/state-panel";
import type { EmployerJobDetail } from "@/lib/employers/types";

/**
 * Job Detail actions (F13-D): View Applicants, Edit, Publish/Close, Delete
 * draft, Feature. Every action calls the real backend and only reports what
 * it confirmed — a plan-capacity or credit refusal is shown with the
 * backend's own wording, and nothing is marked published optimistically.
 */
export default function JobDetailActions({ job, orgId }: { job: EmployerJobDetail; orgId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<"publish" | "close" | "delete" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function run(action: "publish" | "close" | "delete") {
    setPending(action);
    setFailure(null);
    const result =
      action === "publish"
        ? await publishEmployerJob(orgId, job.id)
        : action === "close"
          ? await closeEmployerJob(orgId, job.id)
          : await deleteEmployerJobDraft(orgId, job.id);
    setPending(null);
    if (result.status === "unavailable") {
      setFailure(result.reason);
      return;
    }
    router.refresh();
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
        {job.status === "Draft" ? (
          <>
            <Link href={`/employers/jobs/${job.id}/edit`} className="emp-btn-secondary">
              Edit Job
            </Link>
            <button
              type="button"
              className="emp-btn-secondary is-danger"
              onClick={() => run("delete")}
              disabled={pending !== null}
            >
              {pending === "delete" ? "Deleting…" : "Delete Draft"}
            </button>
          </>
        ) : null}
        {job.status !== "Published" ? (
          <button type="button" className="emp-btn-secondary" onClick={() => run("publish")} disabled={pending !== null}>
            {pending === "publish" ? "Publishing…" : "Publish"}
          </button>
        ) : (
          <button type="button" className="emp-btn-secondary is-danger" onClick={() => run("close")} disabled={pending !== null}>
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
