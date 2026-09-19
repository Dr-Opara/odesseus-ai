"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function MatchForm() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, roleTitle, jobDescription }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Odysseus could not analyze this role.");
      }

      router.push(`/match/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="card" style={{ padding: 28 }}>
        <div className="match-meta-grid">
          <label className="field-label">
            Company <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
            <input
              className="input"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              placeholder="e.g. Microsoft"
            />
          </label>

          <label className="field-label">
            Role <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
            <input
              className="input"
              value={roleTitle}
              onChange={(event) => setRoleTitle(event.target.value)}
              placeholder="e.g. Senior GRC Manager"
            />
          </label>
        </div>

        <label className="field-label" style={{ marginTop: 18 }}>
          Job description
          <textarea
            className="input match-textarea"
            value={jobDescription}
            onChange={(event) => setJobDescription(event.target.value)}
            placeholder="Paste the complete job description here…"
            required
            minLength={200}
          />
        </label>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18, marginTop: 18, flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 13 }}>
            Odysseus compares this only against your verified profile and resume.
          </span>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Analyzing match…" : "Analyze match"}
          </button>
        </div>

        {error ? (
          <div style={{ marginTop: 16, padding: 12, borderRadius: 12, background: "#fff1ef", fontSize: 14 }}>
            {error}
          </div>
        ) : null}
      </div>
    </form>
  );
}
