"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type RelocationPreference = "open" | "not_open" | "case_by_case" | "";

type JobPreferencesFormProps = {
  userId: string;
  initial: {
    min_match_score: number;
    target_titles: string[] | null;
    target_locations: string[] | null;
    remote_only: boolean;
    remote_allowed?: boolean;
    hybrid_allowed?: boolean;
    onsite_allowed?: boolean;
    excluded_companies?: string[] | null;
    excluded_titles?: string[] | null;
    relocation_preference?: string | null;
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
  const [remoteAllowed, setRemoteAllowed] = useState(initial?.remote_allowed ?? true);
  const [hybridAllowed, setHybridAllowed] = useState(initial?.hybrid_allowed ?? true);
  const [onsiteAllowed, setOnsiteAllowed] = useState(initial?.onsite_allowed ?? true);
  const [excludedCompanies, setExcludedCompanies] = useState(joinList(initial?.excluded_companies));
  const [excludedTitles, setExcludedTitles] = useState(joinList(initial?.excluded_titles));
  const [relocationPreference, setRelocationPreference] = useState<RelocationPreference>(
    (initial?.relocation_preference as RelocationPreference) || ""
  );
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
      remote_allowed: remoteAllowed,
      hybrid_allowed: hybridAllowed,
      onsite_allowed: onsiteAllowed,
      excluded_companies: splitList(excludedCompanies),
      excluded_titles: splitList(excludedTitles),
      relocation_preference: relocationPreference || null,
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

        <div className="field-label">
          Work arrangement
          <div style={{ display: "flex", gap: 16, marginTop: 6 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
              <input type="checkbox" checked={remoteAllowed} onChange={(e) => setRemoteAllowed(e.target.checked)} />
              Remote
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
              <input type="checkbox" checked={hybridAllowed} onChange={(e) => setHybridAllowed(e.target.checked)} />
              Hybrid
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
              <input type="checkbox" checked={onsiteAllowed} onChange={(e) => setOnsiteAllowed(e.target.checked)} />
              On-site
            </label>
          </div>
        </div>

        <label className="field-label">
          Relocation
          <select
            className="input"
            value={relocationPreference}
            onChange={(e) => setRelocationPreference(e.target.value as RelocationPreference)}
          >
            <option value="">Not stated</option>
            <option value="open">Open to relocating</option>
            <option value="not_open">Not open to relocating</option>
            <option value="case_by_case">Depends on the role</option>
          </select>
        </label>

        <label className="field-label">
          Companies to exclude (comma-separated)
          <input
            className="input"
            value={excludedCompanies}
            onChange={(e) => setExcludedCompanies(e.target.value)}
            placeholder="Current employer, competitors"
          />
        </label>
        <label className="field-label">
          Titles to exclude (comma-separated)
          <input
            className="input"
            value={excludedTitles}
            onChange={(e) => setExcludedTitles(e.target.value)}
            placeholder="Intern, Contract"
          />
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 20 }}>
        <button className="btn btn-primary" type="submit">Save changes</button>
        {status ? <span className="muted" style={{ fontSize: 14 }}>{status}</span> : null}
      </div>
    </form>
  );
}
