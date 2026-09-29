"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { moveCandidateStageAction } from "@/lib/employers/actions";
import EmployerStatePanel from "@/components/employers/state-panel";
import type { PipelineStage } from "@/lib/employers/types";

/**
 * Candidate Detail quick actions (Figma screen 79).
 *
 * The transition goes to the pipeline route, which verifies the applicant
 * belongs to this job through the attribution edge and appends to the
 * append-only stage history.
 *
 * The button label changes first and rolls back if the backend refuses, so the
 * employer sees their intent immediately and the real outcome. That optimism is
 * safe only because a failure here is a genuine refusal: nothing reports a
 * move as done unless the backend recorded it.
 */
export default function CandidateStageActions({
  orgId,
  applicationId,
  jobId,
  currentStage,
}: {
  orgId: string;
  applicationId: string;
  jobId: string;
  currentStage: PipelineStage;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<PipelineStage | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function move(toStage: PipelineStage) {
    setPending(toStage);
    setFailure(null);
    const result = await moveCandidateStageAction(orgId, applicationId, jobId, toStage);
    setPending(null);
    if (result.status === "unavailable") {
      setFailure(result.reason);
      return;
    }
    // Re-read so the stage shown is the one the backend recorded.
    router.refresh();
  }

  // Hired and Rejected are terminal: neither button would be meaningful, so
  // the whole action block is hidden rather than showing two dead controls.
  if (currentStage === "HIRED" || currentStage === "REJECTED") return null;

  return (
    <div style={{ marginTop: 24 }}>
      <div className="emp-page-actions">
        <button
          type="button"
          className="figma-btn figma-btn-orange"
          onClick={() => move("INTERVIEW")}
          disabled={pending !== null || currentStage === "INTERVIEW"}
        >
          {pending === "INTERVIEW" ? "Moving…" : "Move to Interview"}
        </button>
        <button
          type="button"
          className="emp-btn-secondary is-danger"
          onClick={() => move("REJECTED")}
          disabled={pending !== null}
        >
          {pending === "REJECTED" ? "Rejecting…" : "Reject"}
        </button>
      </div>
      {failure ? (
        <div style={{ marginTop: 16 }}>
          <EmployerStatePanel
            kind="error"
            title="Couldn&rsquo;t update this applicant&rsquo;s stage"
            message={failure}
          />
        </div>
      ) : null}
    </div>
  );
}
