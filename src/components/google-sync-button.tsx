"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GoogleSyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function sync() {
    setBusy(true);
    setMessage("");

    const response = await fetch("/api/integrations/google/sync", {
      method: "POST",
    });
    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error || "Odysseus could not sync Google.");
      setBusy(false);
      return;
    }

    setMessage(
      `Synced ${data.gmailCount || 0} email signal${data.gmailCount === 1 ? "" : "s"} and ${data.calendarCount || 0} calendar event${data.calendarCount === 1 ? "" : "s"}.`
    );
    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      <button className="btn btn-secondary" onClick={sync} disabled={busy}>
        {busy ? "Syncing…" : "Sync now"}
      </button>
      {message ? <div className="muted" style={{ fontSize: 13, marginTop: 9 }}>{message}</div> : null}
    </div>
  );
}
