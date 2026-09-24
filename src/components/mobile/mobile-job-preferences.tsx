"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import MobileScreen from "@/components/mobile/mobile-screen";

/**
 * Mobile Job Preferences (screen 17). Reads and writes the same
 * `job_preferences` columns (min_match_score, target_titles,
 * target_locations, remote_only) the desktop Job Preferences form uses —
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
  } | null;
}) {
  const supabase = createClient();
  const [minMatchScore, setMinMatchScore] = useState(initial?.min_match_score ?? 85);
  const [targetTitles, setTargetTitles] = useState((initial?.target_titles ?? []).join(", "));
  const [targetLocations, setTargetLocations] = useState((initial?.target_locations ?? []).join(", "));
  const [remoteOnly, setRemoteOnly] = useState(initial?.remote_only ?? false);
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

        {status ? <p className="m-note">{status}</p> : null}
        <button className="m-action" type="submit">
          Save
        </button>
      </form>

      <div className="m-note" style={{ marginTop: 16 }}>
        These preferences steer matching and job discovery. Separate multiple
        titles or locations with commas.
      </div>
    </MobileScreen>
  );
}