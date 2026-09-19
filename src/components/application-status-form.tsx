"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applicationStatuses,
  applicationStatusLabels,
  type ApplicationStatus,
} from "@/lib/applications/status";

export default function ApplicationStatusForm({
  applicationId,
  currentStatus,
}: {
  applicationId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<ApplicationStatus>(
    applicationStatuses.includes(currentStatus as ApplicationStatus)
      ? (currentStatus as ApplicationStatus)
      : "applied"
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    const response = await fetch(`/api/applications/${applicationId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, note }),
    });

    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error || "Odysseus could not update the application.");
      setBusy(false);
      return;
    }

    setNote("");
    setMessage("Updated");
    setBusy(false);
    router.refresh();
  }

  return (
    <form className="card track-status-card" onSubmit={submit}>
      <div>
        <div className="muted" style={{ fontSize: 13 }}>Update status</div>
        <h2 style={{ fontSize: 22, margin: "7px 0 0" }}>What happened next?</h2>
      </div>

      <label className="field-label">
        Status
        <select
          className="input"
          value={status}
          onChange={(event) => setStatus(event.target.value as ApplicationStatus)}
        >
          {applicationStatuses.map((item) => (
            <option key={item} value={item}>
              {applicationStatusLabels[item]}
            </option>
          ))}
        </select>
      </label>

      <label className="field-label">
        Note <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
        <textarea
          className="input track-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Add context you want Odysseus to remember…"
        />
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save update"}
        </button>
        {message ? <span className="muted" style={{ fontSize: 13 }}>{message}</span> : null}
      </div>
    </form>
  );
}
