"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApplyTier } from "@/lib/pricing/candidate-pricing";

export default function ApplyStartForm({
  jobId,
  defaultUrl,
  applyTier,
}: {
  jobId: string;
  defaultUrl?: string | null;
  /**
   * INTEGRATION POINT: /api/apply/start (backend/pricing-wallet) does not
   * read this field yet — it still charges from the legacy application
   * credit balance regardless of tier. Sent additively so the backend can
   * start reading it once the wallet per-tier charge lands, without another
   * frontend change.
   */
  applyTier?: ApplyTier;
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
      body: JSON.stringify({ jobId, targetUrl: url, applyTier }),
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.runId) {
        router.push(`/apply/run/${data.runId}`);
        return;
      }
      setError(data.error || "Odesseus could not start this application.");
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
        <strong>Odesseus can handle the repetitive parts.</strong>
        <span>It will pause for login, MFA, CAPTCHA, identity checks, sensitive questions, or anything it cannot answer from verified information.</span>
      </div>

      {error ? <div className="apply-error">{error}</div> : null}

      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "Starting secure browser…" : "Start application"}
      </button>
    </form>
  );
}
