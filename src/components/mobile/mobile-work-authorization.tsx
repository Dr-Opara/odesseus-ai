"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type AuthorizationStatus = "authorized" | "sponsorship_required" | "unspecified";

function statusFor(initial: {
  authorized_without_sponsorship: boolean;
  sponsorship_required: boolean;
}): AuthorizationStatus {
  if (initial.authorized_without_sponsorship) return "authorized";
  if (initial.sponsorship_required) return "sponsorship_required";
  return "unspecified";
}

/**
 * Work Authorization (screen 32). Reads and writes
 * `candidate_work_authorization` — a dedicated, owner-only-RLS table for
 * applicant-declared work authorization facts. Every field here is
 * self-reported; Odesseus never infers a legal work-authorization answer.
 */
export default function MobileWorkAuthorization({
  userId,
  initial,
}: {
  userId: string;
  initial: {
    country_code: string | null;
    authorized_without_sponsorship: boolean;
    sponsorship_required: boolean;
    relocation_allowed: boolean;
  };
}) {
  const supabase = createClient();
  const [countryCode, setCountryCode] = useState(initial.country_code ?? "");
  const [status, setStatusValue] = useState<AuthorizationStatus>(statusFor(initial));
  const [relocationAllowed, setRelocationAllowed] = useState(initial.relocation_allowed);
  const [saveStatus, setSaveStatus] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveStatus("Saving…");

    const normalizedCountry = countryCode.trim().toUpperCase();
    if (normalizedCountry && !/^[A-Z]{2}$/.test(normalizedCountry)) {
      setSaveStatus("Use a 2-letter country code, e.g. US.");
      return;
    }

    const { error } = await supabase.from("candidate_work_authorization").upsert({
      user_id: userId,
      country_code: normalizedCountry || null,
      authorized_without_sponsorship: status === "authorized",
      sponsorship_required: status === "sponsorship_required",
      relocation_allowed: relocationAllowed,
    });

    setSaveStatus(error ? error.message : "Saved");
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
          <span>Country you are authorized to work in</span>
          <input
            className="m-input"
            value={countryCode}
            onChange={(event) => setCountryCode(event.target.value)}
            placeholder="US"
            maxLength={2}
          />
        </label>

        <label className="m-field">
          <span>Sponsorship</span>
          <select
            className="m-input"
            value={status}
            onChange={(event) => setStatusValue(event.target.value as AuthorizationStatus)}
          >
            <option value="unspecified">Prefer not to say</option>
            <option value="authorized">Authorized — no sponsorship needed</option>
            <option value="sponsorship_required">Requires employer sponsorship</option>
          </select>
        </label>

        <div className="m-card m-toggle-row" style={{ margin: "0 4px 16px" }}>
          <span className="m-copy">
            <strong>Open to relocation?</strong>
          </span>
          <label className="m-switch">
            <input
              type="checkbox"
              checked={relocationAllowed}
              onChange={(event) => setRelocationAllowed(event.target.checked)}
            />
            <span />
          </label>
        </div>

        {saveStatus ? <p className="m-note">{saveStatus}</p> : null}
        <button className="m-action" type="submit">
          Save
        </button>
      </form>
    </main>
  );
}
