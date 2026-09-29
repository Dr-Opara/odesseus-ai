"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { moveCandidateStage } from "@/lib/employers/pipeline-adapter";
import EmployerStatePanel from "@/components/employers/state-panel";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/employers/types";

const STAGE_LABELS: Record<PipelineStage, string> = {
  APPLIED: "Applied",
  REVIEWING: "Reviewing",
  SHORTLISTED: "Shortlisted",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  HIRED: "Hired",
  REJECTED: "Rejected",
};

/**
 * Applicant stage actions (F13-K). The stage vocabulary is locked to the seven
 * backend stages, in order. A move is applied optimistically and rolled back
 * to the stage the backend still holds whenever the transition is refused, so
 * the board never shows a stage the backend did not record.
 */
export default function CandidateStageActions({
  orgId,
  candidateId,
  jobId,
  currentStage,
}: {
  orgId: string;
  candidateId: string;
  jobId: string;
  currentStage: PipelineStage;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<PipelineStage>(currentStage);
  const [pending, setPending] = useState<PipelineStage | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function move(toStage: PipelineStage) {
    if (toStage === stage) return;
    const previous = stage;
    setStage(toStage);
    setPending(toStage);
    setFailure(null);

    const result = await moveCandidateStage(orgId, { jobId, applicationId: candidateId, toStage });
    setPending(null);
    if (result.status === "unavailable") {
      setStage(previous);
      setFailure(result.reason);
      return;
    }
    setStage(result.data.stage);
    router.refresh();
  }

  return (
    <div style={{ marginTop: 24 }}>
      <div className="emp-row-list" style={{ marginTop: 6 }}>
        <div className="emp-row">
          <span className="emp-row-label">Current stage</span>
          <span className="emp-row-value">{STAGE_LABELS[stage]}</span>
        </div>
      </div>

      <div className="emp-page-actions" style={{ marginTop: 16 }}>
        {PIPELINE_STAGES.filter((option) => option !== stage).map((option) => (
          <button
            key={option}
            type="button"
            className={option === "REJECTED" ? "emp-btn-secondary is-danger" : "emp-btn-secondary"}
            onClick={() => move(option)}
            disabled={pending !== null}
          >
            {pending === option ? "Moving…" : `Move to ${STAGE_LABELS[option]}`}
          </button>
        ))}
      </div>

      {failure ? (
        <div style={{ marginTop: 16 }}>
          <EmployerStatePanel kind="error" title="Couldn't update this applicant's stage" message={failure} />
        </div>
      ) : null}
    </div>
  );
}
