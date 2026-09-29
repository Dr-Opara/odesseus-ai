import { requireEmployerPage } from "@/app/employers/guard";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import AddSeatButton from "@/components/employers/add-seat-button";
import InviteTeamForm from "@/components/employers/invite-team-form";
import { getEmployerTeam } from "@/lib/employers/team-adapter";
import { RECRUITER_SEAT_PRICE_LABEL, RECRUITER_SEAT_UNIT } from "@/lib/pricing/candidate-pricing";

/**
 * Recruiter Seats / Team (Figma screen 84, F13-M). Membership and seats stay
 * backend-owned: the roster, the outstanding invitations, and the seat
 * arithmetic are all read from the team endpoint, and every change goes
 * through the backend.
 */
export default async function EmployerTeamPage() {
  const { orgId } = await requireEmployerPage("/employers/team");

  const teamResult = await getEmployerTeam(orgId);

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <h1>Recruiter Seats</h1>
          <p className="muted">Manage employer team access.</p>

          <div style={{ marginTop: 24 }}>
            {teamResult.status === "ok" ? (
              <>
                <EmployerRowList>
                  <EmployerRow
                    label="Seats in use"
                    value={`${teamResult.data.seats.active} of ${teamResult.data.seats.required}`}
                  />
                  {teamResult.data.members.map((member) => (
                    <EmployerRow
                      key={member.id}
                      label={`${member.role}${member.isYou ? " (you)" : ""}`}
                      value={member.joinedAt ? `Joined ${new Date(member.joinedAt).toLocaleDateString()}` : "Active"}
                    />
                  ))}
                  {teamResult.data.invitations.map((invitation) => (
                    <EmployerRow
                      key={invitation.id}
                      label={invitation.name}
                      value={`${invitation.role} · Pending invitation`}
                    />
                  ))}
                  <EmployerRow
                    label="Additional seat"
                    value={`${RECRUITER_SEAT_PRICE_LABEL}${RECRUITER_SEAT_UNIT.replace("per additional seat", "").trim()}`}
                  />
                </EmployerRowList>

                {teamResult.data.members.length === 0 && teamResult.data.invitations.length === 0 ? (
                  <div style={{ marginTop: 18 }}>
                    <EmployerStatePanel kind="empty" title="No Team Members Yet" message="Add a recruiter seat to start building your hiring team." />
                  </div>
                ) : null}

                {teamResult.data.isCallerAdmin ? <InviteTeamForm orgId={orgId} /> : null}
                <AddSeatButton orgId={orgId} />
              </>
            ) : (
              <EmployerStatePanel kind="error" title="We couldn't load your team" message={teamResult.reason} />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
