"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type JobPreferencesFormProps = {
  userId: string;
  initial: {
    min_match_score: number;
    target_titles: string[] | null;
    target_locations: string[] | null;
    remote_only: boolean;
  } | null;
};

function joinList(values: string[] | null | undefined) {
  return (values ?? []).join(", ");
}

function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function JobPreferencesForm({ userId, initial }: JobPreferencesFormProps) {
  const supabase = createClient();
  const [minMatchScore, setMinMatchScore] = useState(initial?.min_match_score ?? 85);
  const [targetTitles, setTargetTitles] = useState(joinList(initial?.target_titles));
  const [targetLocations, setTargetLocations] = useState(joinList(initial?.target_locations));
  const [remoteOnly, setRemoteOnly] = useState(initial?.remote_only ?? false);
  const [status, setStatus] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Saving…");

    const { error } = await supabase.from("job_preferences").upsert({
      user_id: userId,
      min_match_score: minMatchScore,
      target_titles: splitList(targetTitles),
      target_locations: splitList(targetLocations),
      remote_only: remoteOnly,
    });

    setStatus(error ? error.message : "Saved");
  }

  return (
    <form className="card" style={{ padding: 26 }} onSubmit={save}>
      <div className="muted" style={{ fontSize: 13 }}>Job discovery</div>
      <h2 style={{ fontSize: 22, margin: "7px 0 16px" }}>Search preferences</h2>

      <div style={{ display: "grid", gap: 14 }}>
        <label className="field-label">
          Minimum match score ({minMatchScore}%+)
          <input
            className="input"
            type="range"
            min={50}
            max={100}
            step={5}
            value={minMatchScore}
            onChange={(e) => setMinMatchScore(Number(e.target.value))}
          />
        </label>
        <label className="field-label">
          Target titles (comma-separated)
          <input
            className="input"
            value={targetTitles}
            onChange={(e) => setTargetTitles(e.target.value)}
            placeholder="Compliance Analyst, GRC Manager"
          />
        </label>
        <label className="field-label">
          Target locations (comma-separated)
          <input
            className="input"
            value={targetLocations}
            onChange={(e) => setTargetLocations(e.target.value)}
            placeholder="Houston, TX; Remote"
          />
        </label>
        <label className="field-label" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <input
            type="checkbox"
            checked={remoteOnly}
            onChange={(e) => setRemoteOnly(e.target.checked)}
          />
          Remote roles only
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 20 }}>
        <button className="btn btn-primary" type="submit">Save changes</button>
        {status ? <span className="muted" style={{ fontSize: 14 }}>{status}</span> : null}
      </div>
    </form>
  );
}
