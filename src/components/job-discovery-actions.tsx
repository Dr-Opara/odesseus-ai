"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function JobDiscoveryActions({
  jobId,
  isSaved,
}: {
  jobId: string;
  isSaved: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"save" | "ignore" | null>(null);

  async function update(status: "saved" | "rejected", action: "save" | "ignore") {
    setBusy(action);
    try {
      const response = await fetch(`/api/jobs/${jobId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (response.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="job-discovery-secondary-actions">
      {!isSaved ? (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy !== null}
          onClick={() => update("saved", "save")}
        >
          {busy === "save" ? "Saving…" : "Save"}
        </button>
      ) : (
        <span className="muted" style={{ fontSize: 13 }}>Saved</span>
      )}
      <button
        type="button"
        className="app-logout"
        disabled={busy !== null}
        onClick={() => update("rejected", "ignore")}
      >
        {busy === "ignore" ? "Removing…" : "Not interested"}
      </button>
    </div>
  );
}
