import Link from "next/link";
import { requireEmployerOverview } from "@/app/employers/dashboard/overview";
import { getTeamView } from "@/lib/employers/team-adapter";
import { getEmployerOrgId } from "@/lib/employers/context";
import { memberRoleLabel } from "@/lib/employer/plans";
import {
  EXTRA_RECRUITER_SEAT_PRICE_LABEL,
  EXTRA_RECRUITER_SEAT_UNIT,
} from "@/lib/employer/plans";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import AddSeatButton from "@/components/employers/add-seat-button";
import InviteTeamMemberForm from "@/components/employers/invite-team-member-form";
import { EmployerNotices } from "@/components/employer/employer-cards";
import EmployerMobileScreen, {
  EmployerDesktopOnlyNotice,
} from "@/components/employer/employer-mobile-screen";

/**
 * Employer Team (Figma screen 84) on the canonical `/employers/dashboard/team`
 * route.
 *
 * The backend route with the Figma presentation. It keeps the backend page's
 * `requireEmployerOverview` guard and its read-only phone rendering, and adds
 * the Figma row list, the seat summary, and the two actions the backend
 * supports: an admin invites someone, and an admin buys a seat.
 *
 * Two honest limits the backend imposes, reflected rather than papered over:
 * `employer_members` stores user ids, not names, so a member row shows a short
 * id; and invitations are owner/admin-only, so a recruiter sees no invitation
 * section rather than an empty one implying they looked and found nothing.
 */
export default async function EmployerTeamPage() {
  const [overview, team, orgId] = await Promise.all([
    requireEmployerOverview("/employers/dashboard/team"),
    getTeamView(),
    getEmployerOrgId(),
  ]);

  const orgName = overview.organization?.name ?? overview.account.companyName;
  const canSeeInvitations = overview.yourRole === "owner" || overview.yourRole === "admin";

  return (
    <main className="figma-site figma-soft-page employer-portal">
      <div className="figma-page-wrap">
        <div className="odesseus-desktop-only">
          <EmployerAppNav />
        </div>

        <section className="odesseus-desktop-only" style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
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
          ) : team.status === "ok" ? (
            <>
              <div style={{ marginTop: 24 }}>
                <EmployerRowList>
                  <EmployerRow
                    label="Seats used"
                    value={`${team.data.seats.used} of ${team.data.seats.required} included`}
                  />
                  <EmployerRow label="Seats paid" value={team.data.seats.paid} />
                  <EmployerRow
                    label="Seats available"
                    value={
                      team.data.seats.available > 0
                        ? team.data.seats.available
                        : "No seats available"
                    }
                  />
                  <EmployerRow
                    label="Additional seat"
                    value={`${EXTRA_RECRUITER_SEAT_PRICE_LABEL} ${EXTRA_RECRUITER_SEAT_UNIT}`}
                  />
                </EmployerRowList>
              </div>

              <h2 style={{ fontSize: 20, margin: "32px 0 12px" }}>Members</h2>
              {team.data.members.length ? (
                <EmployerRowList>
                  {team.data.members.map((member) => (
                    <EmployerRow
                      key={member.id}
                      label={member.name}
                      value={memberRoleLabel(member.role.toLowerCase())}
                    />
                  ))}
                </EmployerRowList>
              ) : (
                <EmployerStatePanel
                  kind="empty"
                  title="No Team Members Yet"
                  message="Add a recruiter seat to start building your hiring team."
                />
              )}
              <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
                Members are listed by account id. Names and email addresses are not readable
                from an employer session.
              </p>

              {canSeeInvitations ? (
                <>
                  <h2 style={{ fontSize: 20, margin: "32px 0 12px" }}>Pending invitations</h2>
                  {team.data.pendingInvitations.length ? (
                    <EmployerRowList>
                      {team.data.pendingInvitations.map((invitation) => (
                        <EmployerRow
                          key={invitation.id}
                          label={invitation.name}
                          value={`${invitation.role} · Invitation pending`}
                        />
                      ))}
                    </EmployerRowList>
                  ) : (
                    <p className="muted" style={{ marginTop: 8 }}>
                      No invitations are waiting for a reply.
                    </p>
                  )}

                  <div style={{ marginTop: 24 }}>
                    <InviteTeamMemberForm orgId={orgId ?? ""} />
                  </div>
                </>
              ) : null}

              <AddSeatButton orgId={orgId ?? ""} />
            </>
          ) : (
            <EmployerStatePanel kind="error" title="Your team isn't available" message={team.reason} />
          )}
        </section>

        <EmployerMobileScreen
          orgName={orgName}
          eyebrow="Employer"
          title="Your team"
          active="Team"
          backHref="/employers/dashboard"
          lead={`${overview.members.length} member${overview.members.length === 1 ? "" : "s"}${
            overview.yourRole
              ? ` · you are ${memberRoleLabel(overview.yourRole).toLowerCase()}`
              : ""
          }`}
        >
          {overview.members.length ? (
            <div className="m-list" style={{ margin: "0 4px" }}>
              {overview.members.map((member) => (
                <div className="m-card employer-m-job" key={member.userId}>
                  <div className="m-copy">
                    <strong>
                      {member.userId.length > 8 ? `${member.userId.slice(0, 8)}…` : member.userId}
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
