import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/app-shell";
import JobDiscoveryButton from "@/components/job-discovery-button";
import JobDiscoveryActions from "@/components/job-discovery-actions";
import MobileJobs from "@/components/mobile/mobile-jobs";
import {
  getCandidateProfile,
  getCandidateUserId,
  getCreditBalance,
  getJobPreferences,
  getRecommendedJobs,
} from "@/lib/candidate/service";

function sourceLabel(source: string | null) {
  if (!source) return "Job source";
  if (source.startsWith("greenhouse:")) return "Greenhouse";
  if (source.startsWith("lever:")) return "Lever";
  if (source.startsWith("ashby:")) return "Ashby";
  if (source === "manual") return "Manual";
  return source;
}

export default async function JobsPage() {
  const supabase = await createClient();
  const userId = await getCandidateUserId(supabase);
  if (!userId) redirect("/login");

  const [profile, credits, preferences, jobs] = await Promise.all([
    getCandidateProfile(supabase, userId),
    getCreditBalance(supabase, userId),
    getJobPreferences(supabase, userId),
    getRecommendedJobs(supabase, userId, { limit: 100 }),
  ]);

  if (!profile?.onboarding_completed) redirect("/onboarding");

  const threshold = preferences?.min_match_score ?? 85;
  const strongMatches = jobs.filter((job) => (job.match_score ?? 0) >= threshold);
  const saved = jobs.filter((job) => job.status === "saved");

  return (
    <AppShell
      fullName={profile.full_name}
      walletBalanceCents={credits.walletBalanceCents}
      interviewPasses={credits.interviewPasses}
      active="jobs"
    >
      <section className="shell odesseus-desktop-only" style={{ padding: "54px 0 100px" }}>
        <div className="jobs-heading">
          <div>
            <div className="badge">Job Discovery</div>
            <h1 style={{ fontSize: 48, letterSpacing: "-0.05em", margin: "14px 0 8px" }}>
              Roles worth looking at.
            </h1>
            <p className="muted" style={{ fontSize: 17, lineHeight: 1.6, maxWidth: 680 }}>
              Odesseus checks configured employer job feeds against your verified profile and keeps roles that clear your {threshold}% match target.
            </p>
          </div>
          <div className="jobs-heading-actions">
            <JobDiscoveryButton />
            <Link className="btn btn-secondary" href="/match">Paste a job instead</Link>
          </div>
        </div>

        <div className="dashboard-stat-grid" style={{ marginTop: 26 }}>
          <div className="card dashboard-stat">
            <span className="muted">Strong matches</span>
            <strong>{strongMatches.length}</strong>
          </div>
          <div className="card dashboard-stat">
            <span className="muted">Saved</span>
            <strong>{saved.length}</strong>
          </div>
          <div className="card dashboard-stat">
            <span className="muted">Match target</span>
            <strong>{threshold}%+</strong>
          </div>
        </div>

        {strongMatches.length ? (
          <div className="jobs-grid">
            {strongMatches.map((job) => (
              <article className="card job-match-card" key={job.id}>
                <div className="job-match-topline">
                  <span className="badge">{job.match_score}% Match</span>
                  <span className="muted" style={{ fontSize: 13 }}>{sourceLabel(job.source)}</span>
                </div>
                <h2 style={{ fontSize: 24, margin: "16px 0 5px" }}>{job.role_title}</h2>
                <div className="muted">{job.company_name}</div>

                <div className="job-match-meta">
                  {job.location ? <span>{job.location}</span> : null}
                  {job.work_arrangement ? <span>{job.work_arrangement}</span> : null}
                  {job.employment_type ? <span>{job.employment_type}</span> : null}
                  {job.salary_text ? <span>{job.salary_text}</span> : null}
                </div>

                <div className="job-match-actions">
                  <Link className="btn btn-primary" href={`/match/${job.id}`}>
                    Review match
                  </Link>
                  {job.source_url ? (
                    <a className="btn btn-secondary" href={job.source_url} target="_blank" rel="noreferrer">
                      View original
                    </a>
                  ) : null}
                  <JobDiscoveryActions jobId={job.id} isSaved={job.status === "saved"} />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="card jobs-empty">
            <h2 style={{ fontSize: 27, margin: "0 0 8px" }}>No strong matches yet.</h2>
            <p className="muted" style={{ lineHeight: 1.6, margin: "0 0 20px" }}>
              Run a refresh to check configured job sources, or paste a role manually while Odesseus keeps looking in the background.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <JobDiscoveryButton />
              <Link className="btn btn-secondary" href="/match">Paste a job</Link>
            </div>
          </div>
        )}
      </section>

      <MobileJobs jobs={jobs} minMatchScore={threshold} />
    </AppShell>
  );
}