import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import AddSeatButton from "@/components/employers/add-seat-button";
import { getTeamMembers } from "@/lib/employers/team-adapter";
import { RECRUITER_SEAT_PRICE_LABEL, RECRUITER_SEAT_UNIT } from "@/lib/pricing/candidate-pricing";

/** Recruiter Seats / Team (Figma screen 84, F13-M). Membership stays backend-owned — no client-side provisioning. */
export default async function EmployerTeamPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/employers/login");
  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  const teamResult = await getTeamMembers();

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <h1>Recruiter Seats</h1>
          <p className="muted">Manage employer team access.</p>

          <div style={{ marginTop: 24 }}>
            {teamResult.status === "ok" && teamResult.data.length > 0 ? (
              <EmployerRowList>
                {teamResult.data.map((member) => (
                  <EmployerRow
                    key={member.id}
                    label={member.name}
                    value={member.status === "Pending" ? `${member.role} · Pending invitation` : member.role}
                  />
                ))}
                <EmployerRow label="Additional seat" value={`${RECRUITER_SEAT_PRICE_LABEL}${RECRUITER_SEAT_UNIT.replace("per additional seat", "").trim()}`} />
              </EmployerRowList>
            ) : teamResult.status === "ok" ? (
              <EmployerStatePanel kind="empty" title="No Team Members Yet" message="Add a recruiter seat to start building your hiring team." />
            ) : (
              <EmployerStatePanel kind="error" title="Team isn't available yet" message={teamResult.reason} />
            )}
          </div>

          <AddSeatButton />
        </section>
      </div>
    </main>
  );
}
