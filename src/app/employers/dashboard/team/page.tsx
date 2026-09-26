import Link from "next/link";
import { requireEmployerOverview } from "@/app/employers/dashboard/overview";
import EmployerPortalHeader from "@/components/employer/employer-portal-header";
import EmployerMobileScreen, {
  EmployerDesktopOnlyNotice,
} from "@/components/employer/employer-mobile-screen";
import { EmployerNotices } from "@/components/employer/employer-cards";
import { memberRoleLabel } from "@/lib/employer/plans";

/**
 * Employer team (Phase 5).
 *
 * A display of who is in the organization and what role each holds, read from
 * `employer_members`. Two honest limits, both access boundaries rather than
 * missing features:
 *
 *  - `employer_members` shows user ids, not names or emails. There is no
 *    employer-readable profile join, so the UI shows a short id and never
 *    invents a person's name or address.
 *  - `employer_member_invitations` is admin/owner-only, so for a recruiter or
 *    viewer the invitation list is legitimately empty and the section is
 *    hidden rather than shown as "no invitations".
 *
 * Seat administration is desktop-first; the phone rendering is a roster.
 */

function shortUserId(userId: string) {
  return userId.length > 8 ? `${userId.slice(0, 8)}…` : userId;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const PENDING_INVITATION_STATUSES = new Set(["pending"]);

export default async function EmployerTeamPage() {
  const overview = await requireEmployerOverview("/employers/dashboard/team");
  const orgName = overview.organization?.name ?? overview.account.companyName;

  const canSeeInvitations = overview.yourRole === "owner" || overview.yourRole === "admin";
  const pendingInvitations = overview.invitations.filter((invitation) =>
    PENDING_INVITATION_STATUSES.has(invitation.status)
  );

  return (
    <main className="figma-site figma-soft-page employer-portal">
      <div className="figma-page-wrap">
        <EmployerPortalHeader orgName={orgName} role={overview.yourRole} />

        <section className="odesseus-desktop-only" style={{ padding: "54px 0 80px" }}>
          <div>
            <span className="figma-eyebrow">TEAM</span>
            <h1>Your team</h1>
            <p className="muted">
              {overview.members.length} member{overview.members.length === 1 ? "" : "s"} in{" "}
              {orgName || "your organization"}.
              {overview.seats
                ? ` ${overview.seats.active} recruiter seat${overview.seats.active === 1 ? "" : "s"} paid.`
                : ""}
            </p>
          </div>

          <EmployerNotices notices={overview.notices} />

          {overview.needsOrganization ? (
            <p className="muted" style={{ marginTop: 24 }}>
              Your company workspace is not set up yet, so there is no team to show.
            </p>
          ) : (
            <>
              <article className="figma-info-card white employer-card" style={{ marginTop: 28 }}>
                <h2>Members</h2>
                {overview.members.length ? (
                  <ul className="employer-member-list">
                    {overview.members.map((member) => (
                      <li key={member.userId}>
                        <div>
                          <strong>{shortUserId(member.userId)}</strong>
                          {member.isYou ? <span className="employer-you-pill">You</span> : null}
                          <span className="muted">
                            {member.joinedAt ? `Joined ${formatDate(member.joinedAt)}` : "Join date unknown"}
                          </span>
                        </div>
                        <span className="employer-role-pill">{memberRoleLabel(member.role)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="dashboard-empty">No members found for this organization.</p>
                )}
                <p className="muted employer-member-note">
                  Members are listed by account id. Names and email addresses are not readable
                  from an employer session.
                </p>
              </article>

              {canSeeInvitations ? (
                <article className="figma-info-card white employer-card" style={{ marginTop: 24 }}>
                  <h2>Invitations</h2>
                  {pendingInvitations.length ? (
                    <ul className="employer-member-list">
                      {pendingInvitations.map((invitation) => (
                        <li key={invitation.id}>
                          <div>
                            <strong>{invitation.email}</strong>
                            <span className="muted">
                              Expires {formatDate(invitation.expiresAt)}
                            </span>
                          </div>
                          <span className="employer-role-pill">
                            {memberRoleLabel(invitation.role)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="dashboard-empty">No invitations are waiting for a reply.</p>
                  )}
                </article>
              ) : null}

              <div className="employer-portal-foot">
                <Link className="link" href="/employers/dashboard">
                  Overview
                </Link>
                <Link className="link" href="/employers/dashboard/jobs">
                  Jobs
                </Link>
                <Link className="link" href="/employers/dashboard/billing">
                  Billing
                </Link>
              </div>
            </>
          )}
        </section>

        <EmployerMobileScreen
          orgName={orgName}
          eyebrow="Employer"
          title="Your team"
          active="Team"
          backHref="/employers/dashboard"
          lead={`${overview.members.length} member${overview.members.length === 1 ? "" : "s"}${
            overview.yourRole ? ` · you are ${memberRoleLabel(overview.yourRole).toLowerCase()}` : ""
          }`}
        >
          {overview.members.length ? (
            <div className="m-list" style={{ margin: "0 4px" }}>
              {overview.members.map((member) => (
                <div className="m-card employer-m-job" key={member.userId}>
                  <div className="m-copy">
                    <strong>
                      {shortUserId(member.userId)}
                      {member.isYou ? " (you)" : ""}
                    </strong>
                    <small>{memberRoleLabel(member.role)}</small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="m-note employer-m-empty">No team members to show yet.</p>
          )}

          <EmployerDesktopOnlyNotice>
            Invite teammates and manage recruiter seats from a desktop browser.
          </EmployerDesktopOnlyNotice>
          <div style={{ height: 84 }} aria-hidden="true" />
        </EmployerMobileScreen>
      </div>
    </main>
  );
}
