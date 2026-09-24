"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const REASONS = [
  "Scam",
  "Fake Company",
  "Misleading Job Description",
  "Misleading Salary",
  "Requests Payment",
  "Phishing Attempt",
  "Duplicate Listing",
  "Incorrect Location",
  "Other",
];

/**
 * Mobile Report Job (screen 33). No job-report table exists yet, so this is
 * a safe, non-destructive visual/demo state: the form is fully interactive,
 * but submitting shows a local confirmation instead of calling a fake API.
 * BACKEND TODO (Phase 5): a real job_reports table + moderation queue.
 */
export default function MobileReportJob({
  roleTitle,
  companyName,
}: {
  roleTitle: string;
  companyName: string;
}) {
  const router = useRouter();
  const [reason, setReason] = useState(REASONS[0]);
  const [details, setDetails] = useState("");
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <main className="odesseus-mobile-only m-screen m-screen-33">
        <header className="m-screen-header">
          <h1>
            <span>Report submitted</span>
          </h1>
        </header>
        <div className="m-note-card m-card" style={{ display: "block" }}>
          <strong>Thank you.</strong>
          <p className="muted" style={{ marginTop: 6 }}>
            Our team reviews every report. This helps keep Odesseus trustworthy for
            everyone.
          </p>
        </div>
        <button className="m-action" type="button" onClick={() => router.back()}>
          Done
        </button>
      </main>
    );
  }

  return (
    <main className="odesseus-mobile-only m-screen m-screen-33">
      <header className="m-screen-header">
        <button type="button" onClick={() => history.back()} aria-label="Back">
          ←
        </button>
        <h1>
          <span>Report Job</span>
        </h1>
      </header>

      <div className="m-report-job-card">
        {companyName ? `${roleTitle} · ${companyName}` : roleTitle}
      </div>

      <p className="m-report-question">What’s the issue with this job or company?</p>

      <div className="m-list">
        {REASONS.map((option) => (
          <button
            key={option}
            type="button"
            className={`m-report-option${reason === option ? " is-selected" : ""}`}
            onClick={() => setReason(option)}
          >
            <span>{option}</span>
            <span className={`m-radio${reason === option ? " is-checked" : ""}`} aria-hidden="true" />
          </button>
        ))}
      </div>

      <p className="m-report-question" style={{ marginTop: 16 }}>
        Additional details (optional)
      </p>
      <textarea
        className="m-report-textarea"
        placeholder="Tell us more about what you noticed…"
        value={details}
        onChange={(event) => setDetails(event.target.value)}
      />

      <div className="m-report-trust-note">
        Our team reviews every report. This helps keep Odesseus trustworthy for everyone.
      </div>

      <button className="m-action" type="button" onClick={() => setSubmitted(true)}>
        Submit Report
      </button>
    </main>
  );
}
