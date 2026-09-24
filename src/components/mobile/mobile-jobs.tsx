"use client";

import { useState } from "react";
import Link from "next/link";
import MobileScreen from "@/components/mobile/mobile-screen";
import MobileSaveJob from "@/components/mobile/mobile-save-job";
import type { CandidateJob } from "@/lib/candidate/types";

function sourceLabel(source: string | null) {
  if (!source) return null;
  if (source.startsWith("greenhouse:")) return "Greenhouse";
  if (source.startsWith("lever:")) return "Lever";
  if (source.startsWith("ashby:")) return "Ashby";
  if (source === "manual") return "Manual";
  return source;
}

/**
 * Mobile Match screen (screen 06) — the real discovered-job list with live
 * match percentages, company, title, location, salary, work arrangement and
 * persisted saved state, plus a Saved tab backed by the same `saved` status
 * records the desktop list uses.
 */
export default function MobileJobs({
  jobs,
  minMatchScore,
}: {
  jobs: CandidateJob[];
  minMatchScore: number;
}) {
  const [tab, setTab] = useState<"matches" | "saved">("matches");

  const strongMatches = jobs.filter(
    (job) => (job.match_score ?? 0) >= minMatchScore
  );
  const saved = jobs.filter((job) => job.status === "saved");

  const visible = tab === "matches" ? strongMatches : saved;
  const savedIds = new Set(saved.map((job) => job.id));

  return (
    <MobileScreen
      index="06"
      title="Match"
      lead="Roles worth looking at, scored against the experience you already verified."
      minHeight={844}
      nav
    >
      <div className="m-segmented">
        <button
          type="button"
          className={tab === "matches" ? "active" : ""}
          onClick={() => setTab("matches")}
        >
          Matches <b>{strongMatches.length}</b>
        </button>
        <button
          type="button"
          className={tab === "saved" ? "active" : ""}
          onClick={() => setTab("saved")}
        >
          Saved <b>{saved.length}</b>
        </button>
      </div>

      <p className="m-stats-line">
        Match target <strong>{minMatchScore}%+</strong>
      </p>

      {visible.length ? (
        <div className="m-list">
          {visible.map((job) => (
            <article className="m-job-card" key={job.id}>
              <Link className="m-job-card-main" href={`/match/${job.id}`}>
                <span className="m-icon">◎</span>
                <span className="m-copy">
                  <strong>{job.role_title}</strong>
                  <small>
                    {job.company_name}
                    {job.location ? ` · ${job.location}` : ""}
                    {job.salary_text ? ` · ${job.salary_text}` : ""}
                  </small>
                </span>
                <b className="m-tag">{job.match_score ?? "—"}%</b>
              </Link>
              <div className="m-job-card-footer">
                <span className="m-job-meta">
                  {job.work_arrangement ? `${job.work_arrangement} · ` : ""}
                  {job.employment_type ? `${job.employment_type} · ` : ""}
                  {sourceLabel(job.source) || "Job source"}
                </span>
                <MobileSaveJob jobId={job.id} isSaved={savedIds.has(job.id)} />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="m-empty">
          {tab === "matches"
            ? `No roles cleared your ${minMatchScore}% target yet. Run a refresh, or paste a role Odesseus should check against your profile.`
            : "Jobs you save will stay here, synced with your desktop account."}
        </div>
      )}
    </MobileScreen>
  );
}