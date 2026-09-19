"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PostAnalysisButton({
  interviewId,
  hasAnalysis,
}: {
  interviewId: string;
  hasAnalysis: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function analyze() {
    setBusy(true);
    setError("");

    const response = await fetch(
      `/api/interviews/${interviewId}/post-analysis`,
      { method: "POST" }
    );

    const data = await response.json();

    if (!response.ok) {
      setError(data.error || "Odysseus could not analyze this interview.");
      setBusy(false);
      return;
    }

    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      <button className="btn btn-primary" onClick={analyze} disabled={busy}>
        {busy
          ? "Analyzing interview…"
          : hasAnalysis
            ? "Refresh analysis"
            : "Analyze interview"}
      </button>
      {error ? <div className="apply-error" style={{ marginTop: 10 }}>{error}</div> : null}
    </div>
  );
}
