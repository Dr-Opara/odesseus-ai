"use client";

import { useState } from "react";
import { createGuestPostAnalysis, type GuestSessionState } from "@/lib/live/guest-share";

type GuidanceItem = NonNullable<GuestSessionState["guidanceItems"]>[number];

/**
 * Guest post-interview result (F2).
 *
 * The backend generates a factual, non-predictive summary of the guest's own
 * interview and a reviewable follow-up draft. It returns no score and no
 * hiring prediction, and neither does this screen: what you see is what the
 * backend confirmed — how many turns were captured, the guidance it produced
 * while you spoke, and whether the follow-up draft was created.
 */
export default function GuestPostInterviewResult({
  token,
  transcriptTurns,
  guidanceItems,
  onRefresh,
}: {
  token: string;
  transcriptTurns: number;
  guidanceItems: GuidanceItem[];
  /** Re-reads the guest session so a second pass shows the stored result. */
  onRefresh?: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "working" | "done" | "failed">("idle");
  const [reason, setReason] = useState("");

  async function run() {
    setStatus("working");
    setReason("");
    const result = await createGuestPostAnalysis(token);
    if (!result.ok) {
      setReason(result.reason);
      setStatus("failed");
      return;
    }
    setStatus("done");
    onRefresh?.();
  }

  return (
    <section className="card" style={{ padding: 28, marginTop: 20 }}>
      <div className="muted" style={{ fontSize: 13 }}>
        Post-interview
      </div>
      <h2 style={{ fontSize: 24, margin: "8px 0 10px" }}>What was captured</h2>

      <div className="live-completed-stats">
        <div>
          <strong>{transcriptTurns}</strong>
          <span className="muted">transcript turns</span>
        </div>
        <div>
          <strong>{guidanceItems.length}</strong>
          <span className="muted">guidance notes</span>
        </div>
      </div>

      {guidanceItems.length > 0 ? (
        <div className="live-transcript-list" style={{ marginTop: 18 }}>
          {guidanceItems.map((item) => (
            <div className="live-transcript-item" key={item.id}>
              {item.question_text ? <div className="badge">Question</div> : null}
              <span>{item.response_text ?? item.question_text ?? ""}</span>
            </div>
          ))}
        </div>
      ) : null}

      <p className="muted" style={{ marginTop: 18, lineHeight: 1.6 }}>
        Odesseus can write a factual summary of this interview and a follow-up draft you can
        review before sending. It does not score the interview or predict an outcome.
      </p>

      {status === "failed" ? <p className="apply-error">{reason}</p> : null}
      {status === "done" ? (
        <p style={{ color: "#1d9e4a", fontWeight: 650, marginTop: 16 }}>
          Your post-interview summary and follow-up draft were created.
        </p>
      ) : null}

      <button
        className="figma-btn figma-btn-orange"
        type="button"
        style={{ marginTop: 18 }}
        onClick={run}
        disabled={status === "working" || status === "done"}
      >
        {status === "working"
          ? "Working…"
          : status === "done"
            ? "Create another summary"
            : "Create post-interview summary"}
      </button>
    </section>
  );
}
