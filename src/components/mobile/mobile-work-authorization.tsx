"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Mobile Work Authorization (screen 32). Reads and writes the same
 * `job_preferences.work_authorization` / `.sponsorship_needed` columns the
 * desktop Job Preferences form uses — self-reported, never inferred.
 */
export default function MobileWorkAuthorization({
  userId,
  initial,
}: {
  userId: string;
  initial: { work_authorization: string | null; sponsorship_needed: boolean | null };
}) {
  const supabase = createClient();
  const [authorizedIn, setAuthorizedIn] = useState(initial.work_authorization ?? "");
  const [sponsorshipNeeded, setSponsorshipNeeded] = useState(initial.sponsorship_needed ?? false);
  const [status, setStatus] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Saving…");
    const { error } = await supabase.from("job_preferences").upsert({
      user_id: userId,
      work_authorization: authorizedIn || null,
      sponsorship_needed: sponsorshipNeeded,
    });
    setStatus(error ? error.message : "Saved");
  }

  return (
    <main className="odesseus-mobile-only m-screen m-screen-32">
      <header className="m-screen-header">
        <button type="button" onClick={() => history.back()} aria-label="Back">
          ←
        </button>
        <h1>
          <span>Work Authorization</span>
        </h1>
      </header>
      <p className="m-lead">
        Self-reported by you — Odesseus does not make legal work-authorization
        determinations.
      </p>

      <form onSubmit={save} className="m-signup-form">
        <label className="m-field">
          <span>Authorized to work in</span>
          <input
            className="m-input"
            value={authorizedIn}
            onChange={(event) => setAuthorizedIn(event.target.value)}
            placeholder="United States, United Kingdom"
          />
        </label>

        <div className="m-card m-toggle-row" style={{ margin: "0 4px 16px" }}>
          <span className="m-copy">
            <strong>Require employer sponsorship?</strong>
          </span>
          <label className="m-switch">
            <input
              type="checkbox"
              checked={sponsorshipNeeded}
              onChange={(event) => setSponsorshipNeeded(event.target.checked)}
            />
            <span />
          </label>
        </div>

        {status ? <p className="m-note">{status}</p> : null}
        <button className="m-action" type="submit">
          Save
        </button>
      </form>
    </main>
  );
}
