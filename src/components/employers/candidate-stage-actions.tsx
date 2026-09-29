"use client";

import { useState } from "react";
import { moveCandidateStage } from "@/lib/employers/pipeline-adapter";
import EmployerStatePanel from "@/components/employers/state-panel";
import type { PipelineStage } from "@/lib/employers/types";

/** Candidate Detail quick actions (Figma screen 79): Move to Interview / Reject. Backend remains authoritative — see F13-K. */
export default function CandidateStageActions({ candidateId, currentStage }: { candidateId: string; currentStage: PipelineStage }) {
  const [pending, setPending] = useState<PipelineStage | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function move(toStage: PipelineStage) {
    setPending(toStage);
    setFailure(null);
    const result = await moveCandidateStage(candidateId, toStage);
    setPending(null);
    if (result.status === "unavailable") setFailure(result.reason);
  }

  if (currentStage === "HIRED" || currentStage === "REJECTED") return null;

  return (
    <div style={{ marginTop: 24 }}>
      <div className="emp-page-actions">
        <button type="button" className="figma-btn figma-btn-orange" onClick={() => move("INTERVIEW")} disabled={pending !== null}>
          {pending === "INTERVIEW" ? "Moving…" : "Move to Interview"}
        </button>
        <button type="button" className="emp-btn-secondary is-danger" onClick={() => move("REJECTED")} disabled={pending !== null}>
          {pending === "REJECTED" ? "Rejecting…" : "Reject"}
        </button>
      </div>
      {failure ? (
        <div style={{ marginTop: 16 }}>
          <EmployerStatePanel kind="error" title="Couldn't update this candidate's stage" message={failure} />
        </div>
      ) : null}
    </div>
  );
}
