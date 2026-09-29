"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestFitScoreAction } from "@/lib/employers/actions";
import EmployerStatePanel from "@/components/employers/state-panel";

/**
 * Requests a Fit Score for an applicant who does not have one yet.
 *
 * The score is computed and persisted by the backend, which also checks the
 * caller's hiring-manager role. This button only asks for it and then
 * re-renders, so the page shows the backend's stored result rather than a
 * score held in browser state.
 */
export default function ScoreApplicantButton({
  orgId,
  applicationId,
  jobId,
}: {
  orgId: string;
  applicationId: string;
  jobId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function score() {
    setPending(true);
    setFailure(null);
    const result = await requestFitScoreAction(orgId, applicationId, jobId);
    setPending(false);

    if (result.status === "unavailable") {
      setFailure(result.reason);
      return;
    }
    // Re-read from the server so the panel shows the persisted row.
    router.refresh();
  }

  return (
    <div>
      <button
        type="button"
        className="figma-btn figma-btn-orange"
        onClick={score}
        disabled={pending}
      >
        {pending ? "Scoring…" : "Score this applicant"}
      </button>
      {failure ? (
        <div style={{ marginTop: 16 }}>
          <EmployerStatePanel
            kind="error"
            title="Could not score this applicant"
            message={failure}
            onRetry={score}
          />
        </div>
      ) : null}
    </div>
  );
}
