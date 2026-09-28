"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import MobileScreen from "@/components/mobile/mobile-screen";

type RelocationPreference = "open" | "not_open" | "case_by_case" | "";

/**
 * Mobile Job Preferences (screen 17). Reads and writes the same
 * `job_preferences` columns the desktop Job Preferences form uses —
 * self-reported, never inferred.
 */
export default function MobileJobPreferences({
  userId,
  initial,
}: {
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
}) {
  const supabase = createClient();
  const [minMatchScore, setMinMatchScore] = useState(initial?.min_match_score ?? 85);
  const [targetTitles, setTargetTitles] = useState((initial?.target_titles ?? []).join(", "));
  const [targetLocations, setTargetLocations] = useState((initial?.target_locations ?? []).join(", "));
  const [remoteOnly, setRemoteOnly] = useState(initial?.remote_only ?? false);
  const [remoteAllowed, setRemoteAllowed] = useState(initial?.remote_allowed ?? true);
  const [hybridAllowed, setHybridAllowed] = useState(initial?.hybrid_allowed ?? true);
  const [onsiteAllowed, setOnsiteAllowed] = useState(initial?.onsite_allowed ?? true);
  const [excludedCompanies, setExcludedCompanies] = useState((initial?.excluded_companies ?? []).join(", "));
  const [excludedTitles, setExcludedTitles] = useState((initial?.excluded_titles ?? []).join(", "));
  const [relocationPreference, setRelocationPreference] = useState<RelocationPreference>(
    (initial?.relocation_preference as RelocationPreference) || ""
  );
  const [status, setStatus] = useState("");

  function splitList(value: string) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

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
    <MobileScreen
      index="17"
      title="Job Preferences"
      lead="Tell Odesseus which roles to look for. You can change these anytime."
    >
      <form onSubmit={save} className="m-signup-form">
        <label className="m-field">
          <span>
            Minimum match score ({minMatchScore}%+)
          </span>
          <input
            className="m-input"
            type="range"
            min={50}
            max={100}
            step={5}
            value={minMatchScore}
            onChange={(event) => setMinMatchScore(Number(event.target.value))}
            style={{ accentColor: "var(--m-orange)", padding: 0, height: 40 }}
          />
        </label>

        <label className="m-field">
          <span>Target titles</span>
          <input
            className="m-input"
            value={targetTitles}
            onChange={(event) => setTargetTitles(event.target.value)}
            placeholder="Compliance Analyst, GRC Manager"
          />
        </label>

        <label className="m-field">
          <span>Target locations</span>
          <input
            className="m-input"
            value={targetLocations}
            onChange={(event) => setTargetLocations(event.target.value)}
            placeholder="Houston, TX; Remote"
          />
        </label>

        <div className="m-card m-toggle-row" style={{ margin: "0 0 16px" }}>
          <span className="m-copy">
            <strong>Remote roles only</strong>
          </span>
          <label className="m-switch">
            <input
              type="checkbox"
              checked={remoteOnly}
              onChange={(event) => setRemoteOnly(event.target.checked)}
            />
            <span />
          </label>
        </div>

        <label className="m-field">
          <span>Work arrangement</span>
          <div style={{ display: "flex", gap: 14, marginTop: 4 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={remoteAllowed} onChange={(e) => setRemoteAllowed(e.target.checked)} />
              Remote
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={hybridAllowed} onChange={(e) => setHybridAllowed(e.target.checked)} />
              Hybrid
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={onsiteAllowed} onChange={(e) => setOnsiteAllowed(e.target.checked)} />
              On-site
            </label>
          </div>
        </label>

        <label className="m-field">
          <span>Relocation</span>
          <select
            className="m-input"
            value={relocationPreference}
            onChange={(event) => setRelocationPreference(event.target.value as RelocationPreference)}
          >
            <option value="">Not stated</option>
            <option value="open">Open to relocating</option>
            <option value="not_open">Not open to relocating</option>
            <option value="case_by_case">Depends on the role</option>
          </select>
        </label>

        <label className="m-field">
          <span>Companies to exclude</span>
          <input
            className="m-input"
            value={excludedCompanies}
            onChange={(event) => setExcludedCompanies(event.target.value)}
            placeholder="Current employer, competitors"
          />
        </label>

        <label className="m-field">
          <span>Titles to exclude</span>
          <input
            className="m-input"
            value={excludedTitles}
            onChange={(event) => setExcludedTitles(event.target.value)}
            placeholder="Intern, Contract"
          />
        </label>

        {status ? <p className="m-note">{status}</p> : null}
        <button className="m-action" type="submit">
          Save
        </button>
      </form>

      <div className="m-note" style={{ marginTop: 16 }}>
        These preferences steer matching, job discovery, and the Application
        Agent&apos;s auto-apply rules. Separate multiple values with commas.
      </div>
    </MobileScreen>
  );
}
