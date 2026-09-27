import Link from "next/link";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { planForTier, subscriptionStatusLabel, jobStatusLabel, memberRoleLabel, featuredOptionForTier } from "@/lib/employer/plans";

export const metadata = { title: "Employer detail — Odesseus Admin" };

export default async function AdminEmployerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: org } = await service.from("employer_organizations").select("*").eq("id", id).maybeSingle();
  if (!org) notFound();

  const [{ data: subscription }, { data: members }, { data: jobs }, { data: featured }, { data: authUsers }] = await Promise.all([
    service.from("employer_subscriptions").select("*").eq("org_id", id).maybeSingle(),
    service.from("employer_members").select("user_id,role,created_at").eq("org_id", id),
    service.from("employer_jobs").select("id,title,status,location,posted_at,created_at").eq("org_id", id).order("created_at", { ascending: false }),
    service.from("featured_listings").select("id,job_id,tier,is_active,starts_at,expires_at").eq("org_id", id),
    service.auth.admin.listUsers({ page: 1, perPage: 200 }),
  ]);

  const emailById = new Map((authUsers?.users || []).map((u) => [u.id, u.email || null]));
  const plan = planForTier(subscription?.tier);
  const featuredByJob = new Map((featured || []).map((f) => [f.job_id, f]));

  return (
    <main className="shell admin-shell">
      <div className="admin-page-heading">
        <div>
          <div className="badge">Admin · Employers</div>
          <h1>{org.name}</h1>
          <p className="muted">Owner: {emailById.get(org.owner_user_id) || org.owner_user_id}</p>
        </div>
        <Link className="btn btn-secondary" href="/admin/employers">Back to employers</Link>
      </div>

      <div className="admin-detail-grid">
        <section className="card">
          <h2>Subscription</h2>
          {subscription ? (
            <div className="admin-detail-list">
              <div><span className="muted">Plan</span><br /><strong>{plan ? `${plan.name} (${plan.priceLabel}${plan.unit})` : "Unrecognised plan"}</strong></div>
              <div><span className="muted">Status</span><br /><strong>{subscriptionStatusLabel(subscription.status)}</strong></div>
              <div><span className="muted">Job posts included</span><br /><strong>{subscription.job_posts_included}</strong></div>
              <div><span className="muted">Period</span><br /><strong>
                {subscription.period_start ? new Date(subscription.period_start).toLocaleDateString() : "—"}
                {" – "}
                {subscription.period_end ? new Date(subscription.period_end).toLocaleDateString() : "—"}
              </strong></div>
            </div>
          ) : (
            <p className="muted">No subscription on file.</p>
          )}
        </section>

        <section className="card">
          <h2>Members ({members?.length || 0})</h2>
          <div className="admin-detail-list">
            {(members || []).map((member) => (
              <div key={member.user_id}>
                <span className="muted">{memberRoleLabel(member.role)}</span><br />
                <strong>{emailById.get(member.user_id) || member.user_id}</strong>
              </div>
            ))}
            {!members?.length ? <p className="muted">No members yet.</p> : null}
          </div>
        </section>
      </div>

      <section className="card admin-section-card">
        <h2>Jobs ({jobs?.length || 0})</h2>
        {jobs?.length ? (
          <div className="admin-table">
            <div className="admin-row header" style={{ ["--admin-row-cols" as string]: "1.6fr .8fr 1fr .8fr" }}>
              <span>Title</span><span>Status</span><span>Location</span><span>Featured</span>
            </div>
            {jobs.map((job) => {
              const feature = featuredByJob.get(job.id);
              const featureOption = feature ? featuredOptionForTier(feature.tier) : null;
              return (
                <div className="admin-row" key={job.id} style={{ ["--admin-row-cols" as string]: "1.6fr .8fr 1fr .8fr" }}>
                  <span><strong>{job.title}</strong></span>
                  <span>{jobStatusLabel(job.status)}</span>
                  <span>{job.location || "—"}</span>
                  <span>
                    {feature && feature.is_active
                      ? `${featureOption?.name || feature.tier} until ${new Date(feature.expires_at).toLocaleDateString()}`
                      : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="admin-empty">No jobs posted by this organization.</div>
        )}
      </section>
    </main>
  );
}
