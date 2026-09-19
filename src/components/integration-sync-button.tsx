"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function IntegrationSyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function sync() {
    setBusy(true);
    setMessage("");

    const response = await fetch("/api/integrations/sync", {
      method: "POST",
    });
    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error || "Odysseus could not sync your accounts.");
      setBusy(false);
      return;
    }

    setMessage(
      `Synced ${data.synced || 0} account${data.synced === 1 ? "" : "s"}${data.failed ? `; ${data.failed} failed` : ""}.`
    );
    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      <button className="btn btn-secondary" onClick={sync} disabled={busy}>
        {busy ? "Syncing…" : "Sync now"}
      </button>
      {message ? (
        <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          {message}
        </div>
      ) : null}
    </div>
  );
}
