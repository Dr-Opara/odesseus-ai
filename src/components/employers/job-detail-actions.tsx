"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { transitionJobAction } from "@/lib/employers/actions";
import EmployerStatePanel from "@/components/employers/state-panel";
import type { EmployerJobDetail } from "@/lib/employers/types";

/**
 * Job Detail actions (F13-D): View Applicants, Edit, Publish/Close, Feature.
 *
 * Each transition goes to the jobs route, which enforces the real rules:
 * publishing is refused without plan capacity, closing is refused for a job
 * that is not published, and a draft can be deleted while a published one
 * cannot. The refusal is shown as the route stated it, and the page is
 * re-read afterwards so the rendered status is the persisted one rather than
 * the requested one.
 *
 * The organization id arrives as a prop from the page, which resolved it
 * server-side. It is a path segment, not a permission: the route re-derives
 * the session and re-checks the caller's role.
 */
export default function JobDetailActions({
  job,
  orgId,
}: {
  job: EmployerJobDetail;
  orgId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"publish" | "close" | "delete" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function run(transition: "publish" | "close" | "delete") {
    setPending(transition);
    setFailure(null);
    const result = await transitionJobAction(orgId, job.id, transition);
    setPending(null);

    if (result.status === "unavailable") {
      setFailure(result.reason);
      return;
    }

    if (transition === "delete") {
      // The row is gone; there is nothing to re-read on this page.
      router.push("/employers/jobs");
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
              className="emp-btn-secondary"
              onClick={() => run("publish")}
              disabled={pending !== null}
            >
              {pending === "publish" ? "Publishing…" : "Publish"}
            </button>
            <button
              type="button"
              className="emp-btn-secondary is-danger"
              onClick={() => run("delete")}
              disabled={pending !== null}
            >
              {pending === "delete" ? "Deleting…" : "Delete draft"}
            </button>
          </>
        ) : job.status === "Published" ? (
          <button
            type="button"
            className="emp-btn-secondary is-danger"
            onClick={() => run("close")}
            disabled={pending !== null}
          >
            {pending === "close" ? "Closing…" : "Close Job"}
          </button>
        ) : null}
        <Link href={`/employers/jobs/${job.id}/feature`} className="emp-btn-secondary">
          Feature this Job
        </Link>
      </div>
      {failure ? (
        <div style={{ marginTop: 16 }}>
          <EmployerStatePanel kind="error" title="Couldn&rsquo;t complete that action" message={failure} />
        </div>
      ) : null}
    </div>
  );
}
