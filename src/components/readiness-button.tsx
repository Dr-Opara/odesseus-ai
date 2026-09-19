"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ReadinessButton({
  interviewId,
  hasReadiness,
}: {
  interviewId: string;
  hasReadiness: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setBusy(true);
    setError("");

    const response = await fetch(
      `/api/interviews/${interviewId}/readiness`,
      { method: "POST" }
    );
    const data = await response.json();

    if (!response.ok) {
      setError(data.error || "Odysseus could not prepare this interview.");
      setBusy(false);
      return;
    }

    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      <button className="btn btn-primary" onClick={generate} disabled={busy}>
        {busy
          ? "Preparing…"
          : hasReadiness
            ? "Refresh readiness"
            : "Prepare interview"}
      </button>
      {error ? <div className="apply-error" style={{ marginTop: 10 }}>{error}</div> : null}
    </div>
  );
}
