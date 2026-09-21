"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function JobDiscoveryButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    setBusy(true);
    setMessage("");

    try {
      const response = await fetch("/api/jobs/discover", { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Odesseus could not refresh jobs.");
        return;
      }

      if (!data.sourcesConfigured) {
        setMessage("Automatic job sources are not configured yet.");
      } else if (data.strongMatchesSaved) {
        setMessage(
          `Found ${data.strongMatchesSaved} new strong match${data.strongMatchesSaved === 1 ? "" : "es"}.`
        );
      } else {
        setMessage("No new strong matches this time.");
      }

      router.refresh();
    } catch {
      setMessage("Odesseus could not refresh jobs.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn btn-primary" type="button" onClick={refresh} disabled={busy}>
        {busy ? "Searching…" : "Find new matches"}
      </button>
      {message ? (
        <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          {message}
        </div>
      ) : null}
    </div>
  );
}
