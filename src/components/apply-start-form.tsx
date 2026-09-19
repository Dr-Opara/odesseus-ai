"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function ApplyStartForm({
  jobId,
  defaultUrl,
}: {
  jobId: string;
  defaultUrl?: string | null;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(defaultUrl || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const response = await fetch("/api/apply/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, targetUrl: url }),
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.runId) {
        router.push(`/apply/run/${data.runId}`);
        return;
      }
      setError(data.error || "Odysseus could not start this application.");
      setBusy(false);
      return;
    }

    router.push(`/apply/run/${data.runId}`);
  }

  return (
    <form onSubmit={submit} className="card apply-start-card">
      <label className="field-label">
        Application page
        <input
          className="input"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://company.com/jobs/..."
          required
        />
      </label>

      <div className="apply-boundaries">
        <strong>Odysseus can handle the repetitive parts.</strong>
        <span>It will pause for login, MFA, CAPTCHA, identity checks, sensitive questions, or anything it cannot answer from verified information.</span>
      </div>

      {error ? <div className="apply-error">{error}</div> : null}

      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "Starting secure browser…" : "Start application"}
      </button>
    </form>
  );
}
