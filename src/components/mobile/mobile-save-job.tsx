"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Mobile save/unsave toggle for a discovered job. Uses the same persisted
 * backend record as the desktop "Save" control (job_opportunities.status =
 * "saved" via POST /api/jobs/[id]/status), so saved state stays consistent
 * between desktop and mobile. No client-side copy of the record is kept.
 */
export default function MobileSaveJob({
  jobId,
  isSaved,
}: {
  jobId: string;
  isSaved: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/jobs/${jobId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: isSaved ? "discovered" : "saved" }),
      });
      if (response.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`m-save-toggle${isSaved ? " is-saved" : ""}`}
      disabled={busy}
      onClick={toggle}
    >
      {busy ? "…" : isSaved ? "✓ Saved" : "Save job"}
    </button>
  );
}