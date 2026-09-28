import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/app-shell";
import MobileHome from "@/components/mobile/mobile-home";
import { getCandidateDashboard } from "@/lib/candidate/dashboard";
import { getCandidateUserId } from "@/lib/candidate/service";
import type { CreditBalance } from "@/lib/candidate/types";
import { MIN_APPLY_PRICE_CENTS, formatCents } from "@/lib/pricing/candidate-pricing";

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || "there";
}

function labelStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatWhen(value: string | null) {
  if (!value) return "Time pending";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function roundLabel(interview: { stage: string | null; roundNumber: number | null }) {
  return `${interview.roundNumber ? `Round ${interview.roundNumber} · ` : ""}${
    interview.stage || "Interview"
  }`;
}

/**
 * The candidate dashboard.
 *
 * The whole page is one call to `getCandidateDashboard`, which answers with
 * native Odesseus data only. Three things are true here that the previous page
 * could not say:
 *
 *  1. Every number is counted in the database over every matching row. The old
 *     "Strong matches" figure counted the five jobs a capped fetch happened to
 *     return, and the pipeline figures counted a capped application list — all
 *     presented with the same confidence as a complete count.
 *  2. Nothing comes from a mailbox, a calendar or an applicant inbox. There is
 *     no `getRecentActivity` here and no `external_signals` dependency, so the
 *     page reads identically whether or not an account is connected.
 *  3. The only limits left are on the short lists — the match cards, the recent
 *     applications and the activity feed — and a limit never touches a count,
 *     because counts come from the RPC and lists carry their own caveat.
 */
export default async function DashboardPage() {
  const supabase = await createClient();
  const userId = await getCandidateUserId(supabase);

  if (!userId) redirect("/login");

  const dashboard = await getCandidateDashboard(supabase, userId);
  const { counts, wallet, agent } = dashboard;

  // The wallet section carries the two balances the shell renders, so the page
  // still issues exactly one aggregation call.
  const credits: CreditBalance = {
    walletBalanceCents: wallet.balanceCents,
    interviewPasses: wallet.interviewPasses,
    liveUnlimitedUntil: wallet.liveUnlimitedUntil,
  };

  const nextInterview = dashboard.upcomingInterviews[0] || null;
  const bestJob = dashboard.topStrongMatches[0] || null;

  const nextAction = nextInterview
    ? {
        eyebrow: "Next up",
        title: roundLabel(nextInterview),
        detail: formatWhen(nextInterview.scheduledAt),
        href: `/interviews/${nextInterview.id}`,
        cta: "Open interview",
      }
    : bestJob
      ? {
          eyebrow: "Strong match",
          title: `${bestJob.role_title} at ${bestJob.company_name}`,
          detail: `${bestJob.match_score ?? "—"}% match${
            bestJob.location ? ` · ${bestJob.location}` : ""
          }`,
          href: `/match/${bestJob.id}`,
          cta: "Review match",
        }
      : {
          eyebrow: "Get started",
          title: "Find your next strong match",
          detail:
            counts.strongMatches > 0
              ? `I found ${counts.strongMatches} role${
                  counts.strongMatches === 1 ? "" : "s"
                } worth looking at.`
              : "Let Odesseus search configured job sources and surface roles that clear your match target.",
          href: "/jobs",
          cta: "Find matches",
        };

  // The application queue is 0-or-1 per candidate by schema, so this is the
  // single figure that says "something is waiting on you" without inventing a
  // backlog where there can only be one current application.
  const needsDecision =
    counts.queueNeedsReview + counts.queueNeedsInput + counts.queueHeld;

  return (
    <AppShell
      fullName={dashboard.candidate.name}
      walletBalanceCents={wallet.balanceCents}
      interviewPasses={wallet.interviewPasses}
      active="home"
    >
      <section className="shell dashboard-v2 odesseus-desktop-only">
        <div className="dashboard-heading">
          <div>
            <div className="muted dashboard-eyebrow">Your workspace</div>
            <h1 className="dashboard-title">
              Good to see you, {firstName(dashboard.candidate.name)}.
            </h1>
            <p className="muted dashboard-subtitle">
              {dashboard.candidate.headline || "Here’s what needs your attention."}
            </p>
          </div>
          <Link className="btn btn-primary" href="/jobs">
            Find jobs
          </Link>
        </div>

        <div className="card dashboard-next-card">
          <div>
            <div className="dashboard-eyebrow">{nextAction.eyebrow}</div>
            <h2>{nextAction.title}</h2>
            <p className="muted">{nextAction.detail}</p>
          </div>
          <Link className="btn btn-primary" href={nextAction.href}>
            {nextAction.cta}
          </Link>
        </div>

        <div className="dashboard-stat-grid">
          <div className="card dashboard-stat">
            <span className="muted">Strong matches</span>
            <strong>{counts.strongMatches}</strong>
          </div>
          <div className="card dashboard-stat">
            <span className="muted">Applications</span>
            <strong>{counts.applicationsTotal}</strong>
          </div>
          <div className="card dashboard-stat">
            <span className="muted">Interviews</span>
            <strong>{counts.interviewsTotal}</strong>
          </div>
          <div className="card dashboard-stat">
            <span className="muted">Need your input</span>
            <strong>{needsDecision}</strong>
          </div>
        </div>

        <div className="dashboard-command-grid">
          <section className="card dashboard-panel">
            <div className="dashboard-panel-heading">
              <div>
                <div className="dashboard-eyebrow">Applications</div>
                <h2>Recent activity</h2>
              </div>
              <Link href="/applications" className="muted">
                View all
              </Link>
            </div>
            {dashboard.recentApplications.length ? (
              <div className="dashboard-list">
                {dashboard.recentApplications.map((application) => (
                  <Link
                    href={`/applications/${application.id}`}
                    className="dashboard-list-row"
                    key={application.id}
                  >
                    <div>
                      <strong>{application.roleTitle}</strong>
                      <span className="muted">{application.companyName}</span>
                    </div>
                    <div className="dashboard-list-meta">
                      <span>{labelStatus(application.status)}</span>
                      <small className="muted">
                        {formatWhen(application.lastEventAt)}
                      </small>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="dashboard-empty">No applications yet.</div>
            )}
          </section>

          <aside className="dashboard-side-stack">
            <section className="card dashboard-panel">
              <div className="dashboard-panel-heading">
                <div>
                  <div className="dashboard-eyebrow">Interviews</div>
                  <h2>Upcoming</h2>
                </div>
                <Link href="/interviews" className="muted">
                  View all
                </Link>
              </div>
              {dashboard.upcomingInterviews.length ? (
                <div className="dashboard-list">
                  {dashboard.upcomingInterviews.map((interview) => (
                    <Link
                      href={`/interviews/${interview.id}`}
                      className="dashboard-list-row compact"
                      key={interview.id}
                    >
                      <div>
                        <strong>{roundLabel(interview)}</strong>
                        <span className="muted">
                          {interview.scheduledAt
                            ? formatWhen(interview.scheduledAt)
                            : "Time pending"}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="dashboard-empty">Nothing scheduled.</div>
              )}
            </section>

            <section className="card dashboard-panel">
              <div className="dashboard-panel-heading">
                <div>
                  <div className="dashboard-eyebrow">Balances</div>
                  <h2>Ready to use</h2>
                </div>
                <Link href="/billing" className="muted">
                  Manage
                </Link>
              </div>
              <div className="dashboard-balance-grid">
                <div>
                  <strong>{formatCents(wallet.balanceCents)}</strong>
                  <span className="muted">Wallet</span>
                </div>
                <div>
                  <strong>{wallet.interviewPasses}</strong>
                  <span className="muted">Interview passes</span>
                </div>
              </div>
              {wallet.balanceCents < MIN_APPLY_PRICE_CENTS ? (
                <Link className="btn btn-primary" href="/billing" style={{ marginTop: 14 }}>
                  Add {formatCents(MIN_APPLY_PRICE_CENTS)} to your wallet
                </Link>
              ) : null}
              {wallet.liveUnlimitedUntil &&
              new Date(wallet.liveUnlimitedUntil) > new Date() ? (
                <div className="badge" style={{ marginTop: 14 }}>
                  Odesseus Live Annual active through{" "}
                  {new Date(wallet.liveUnlimitedUntil).toLocaleDateString()}
                </div>
              ) : null}
            </section>

            {agent ? (
              <section className="card dashboard-panel">
                <div className="dashboard-panel-heading">
                  <div>
                    <div className="dashboard-eyebrow">Application Agent</div>
                    <h2>
                      {agent.paused ? "Paused" : "Watching jobs for you"}
                    </h2>
                  </div>
                </div>
                <div className="dashboard-balance-grid">
                  <div>
                    <strong>{labelStatus(agent.mode)}</strong>
                    <span className="muted">Mode</span>
                  </div>
                  <div>
                    <strong>{agent.decisionsToday}</strong>
                    <span className="muted">Decisions today</span>
                  </div>
                </div>
                <p className="muted dashboard-agent-limit">
                  {agent.paused
                    ? "Nothing runs while the agent is paused."
                    : `Reviews up to ${agent.dailyApplicationLimit} application${
                        agent.dailyApplicationLimit === 1 ? "" : "s"
                      } a day.`}
                </p>
              </section>
            ) : null}
          </aside>
        </div>

        <section className="card dashboard-panel dashboard-activity">
          <div className="dashboard-panel-heading">
            <div>
              <div className="dashboard-eyebrow">Odesseus activity</div>
              <h2>What changed</h2>
            </div>
          </div>
          {dashboard.activity.length ? (
            <div className="dashboard-activity-grid">
              {dashboard.activity.map((item) => (
                <div className="dashboard-activity-item" key={item.id}>
                  <span
                    className={`dashboard-activity-dot${
                      item.needsAttention ? " dashboard-activity-dot-attention" : ""
                    }`}
                  />
                  <div>
                    <strong>{item.title}</strong>
                    {item.detail ? <span className="muted">{item.detail}</span> : null}
                  </div>
                  <small className="muted">{formatWhen(item.occurredAt)}</small>
                </div>
              ))}
            </div>
          ) : (
            <div className="dashboard-empty">
              Odesseus activity will appear here as your search moves forward.
            </div>
          )}
        </section>
      </section>

      <MobileHome
        fullName={dashboard.candidate.name}
        credits={credits}
        strongMatches={dashboard.topStrongMatches}
        recentApplications={dashboard.recentApplications}
        activity={dashboard.activity}
      />
    </AppShell>
  );
}