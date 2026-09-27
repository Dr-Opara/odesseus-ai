import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import { planForTier, subscriptionStatusLabel } from "@/lib/employer/plans";

export const metadata = { title: "Employers — Odesseus Admin" };

export default async function AdminEmployersPage() {
  const service = createServiceClient();

  const [{ data: orgs }, { data: subscriptions }, { data: members }, { data: jobs }] = await Promise.all([
    service.from("employer_organizations").select("id,name,owner_user_id,created_at").order("created_at", { ascending: false }),
    service.from("employer_subscriptions").select("org_id,tier,status,job_posts_included"),
    service.from("employer_members").select("org_id"),
    service.from("employer_jobs").select("org_id,status"),
  ]);

  const subByOrg = new Map((subscriptions || []).map((s) => [s.org_id, s]));
  const memberCountByOrg = new Map<string, number>();
  for (const m of members || []) memberCountByOrg.set(m.org_id, (memberCountByOrg.get(m.org_id) || 0) + 1);
  const jobCountByOrg = new Map<string, number>();
  const publishedCountByOrg = new Map<string, number>();
  for (const j of jobs || []) {
    jobCountByOrg.set(j.org_id, (jobCountByOrg.get(j.org_id) || 0) + 1);
    if (j.status === "published") publishedCountByOrg.set(j.org_id, (publishedCountByOrg.get(j.org_id) || 0) + 1);
  }

  return (
    <main className="shell admin-shell">
      <div className="admin-page-heading">
        <div>
          <div className="badge">Admin · Employers</div>
          <h1>Employer organizations</h1>
          <p className="muted">{orgs?.length || 0} organizations.</p>
        </div>
      </div>

      <div className="card admin-table">
        <div className="admin-row header" style={{ ["--admin-row-cols" as string]: "1.4fr 1fr .8fr .8fr .8fr" }}>
          <span>Organization</span><span>Plan</span><span>Status</span><span>Jobs</span><span>Members</span>
        </div>
        {(orgs || []).map((org) => {
          const subscription = subByOrg.get(org.id);
          const plan = planForTier(subscription?.tier);
          return (
            <Link
              href={`/admin/employers/${org.id}`}
              className="admin-row"
              key={org.id}
              style={{ ["--admin-row-cols" as string]: "1.4fr 1fr .8fr .8fr .8fr" }}
            >
              <span><strong>{org.name}</strong></span>
              <span>{plan ? plan.name : subscription ? "Unrecognised plan" : "No subscription"}</span>
              <span>{subscriptionStatusLabel(subscription?.status)}</span>
              <span>{publishedCountByOrg.get(org.id) || 0} live / {jobCountByOrg.get(org.id) || 0} total</span>
              <span>{memberCountByOrg.get(org.id) || 0}</span>
            </Link>
          );
        })}
        {!orgs?.length ? <div className="admin-empty">No employer organizations yet.</div> : null}
      </div>
    </main>
  );
}
