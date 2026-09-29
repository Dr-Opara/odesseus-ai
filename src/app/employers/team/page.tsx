import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import AddSeatButton from "@/components/employers/add-seat-button";
import InviteTeamMemberForm from "@/components/employers/invite-team-member-form";
import { getTeamView } from "@/lib/employers/team-adapter";
import { getEmployerOrgId } from "@/lib/employers/context";
import {
  EXTRA_RECRUITER_SEAT_PRICE_LABEL,
  EXTRA_RECRUITER_SEAT_UNIT,
  memberRoleLabel,
} from "@/lib/employer/plans";

/**
 * Recruiter Seats / Team (Figma screen 84, F13-M).
 *
 * Membership is backend-owned. This page reads the roster and the seat
 * summary and offers the two actions the backend supports: an admin invites
 * someone, and an admin buys an additional seat. Neither is reimplemented
 * client-side, and no membership change is shown before the server records it.
 *
 * Two honest limits the backend imposes, reflected rather than papered over:
 *
 *  - `employer_members` stores user ids, not names. A member row shows a short
 *    id; no name is invented for someone the server did not name.
 *  - Invitations are owner/admin-only, so a recruiter or viewer sees no
 *    invitation section at all rather than an empty one that implies they
 *    looked and found nothing.
 */
export default async function EmployerTeamPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/employers/login");
  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  const [team, orgId] = await Promise.all([getTeamView(), getEmployerOrgId()]);

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <h1>Recruiter Seats</h1>
          <p className="muted">Manage employer team access.</p>

          <div style={{ marginTop: 24 }}>
            {team.status === "ok" ? (
              <>
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

                <h2 style={{ fontSize: 20, margin: "32px 0 12px" }}>Members</h2>
                {team.data.members.length ? (
                  <EmployerRowList>
                    {team.data.members.map((member) => (
                      <EmployerRow
                        key={member.id}
                        label={member.name}
                        value={`${memberRoleLabel(member.role.toLowerCase())}`}
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

                {team.data.isCallerAdmin ? (
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
              <EmployerStatePanel
                kind="error"
                title="Your team isn't available yet"
                message={team.reason}
              />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
