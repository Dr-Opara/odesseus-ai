import {
  BASE, admin, signIn, call, record, summary,
  grantJobPostCredits, grantSubscription,
} from "./local-integration.mjs";

const PASSWORD = "Integration-Pass-1";
const N = (s) => `${s}-${Date.now()}`;

async function main() {
  console.log(`\n=== CAPACITY ENFORCEMENT (dedicated org, no ambiguity) ===\n`);

  // A dedicated owner, so the org used here is unambiguously this org.
  const owner = await signIn(N("cap-owner") + "@capco.test", PASSWORD, { account_type: "employer" });
  const orgRes = await call(owner, "POST", "/api/employer/orgs", { companyName: "Capacity Co" });
  const orgId = orgRes.json?.org?.id ?? orgRes.json?.id;
  record("capacity", "a dedicated organization exists", !!orgId, `orgId=${orgId}`);

  const sub = await grantSubscription(orgId, "starter", 3);
  const credits = await grantJobPostCredits(orgId, 20);
  record("capacity", "Starter plan active with 20 credits granted",
    sub.status < 400 && credits.status < 400, `sub=${sub.status} credits=${credits.status}`);

  // Confirm the plan row really is starter/3.
  const subRow = await admin(`/rest/v1/employer_subscriptions?org_id=eq.${orgId}&select=tier,status,job_posts_included`);
  record("capacity", "the subscription row reads starter / active",
    (subRow.json ?? [])[0]?.tier === "starter" && (subRow.json ?? [])[0]?.status === "active",
    JSON.stringify(subRow.json ?? subRow.text).slice(0, 180));

  const outcomes = [];
  for (let i = 0; i < 5; i++) {
    const c = await call(owner, "POST", `/api/employer/orgs/${orgId}/jobs`, { title: `Cap Job ${i}` });
    const id = c.json?.id ?? c.json?.job?.id;
    if (!id) { outcomes.push(`create-${c.status}`); continue; }
    const p = await call(owner, "PATCH", `/api/employer/orgs/${orgId}/jobs/${id}`, { action: "publish" });
    outcomes.push(p.status === 200 ? "ok" : `${p.status}/${p.json?.reason ?? p.json?.error}`);
  }
  console.log(`    outcomes: ${outcomes.join("  ")}`);

  const okCount = outcomes.filter((o) => o === "ok").length;
  record("capacity", "exactly 3 publishes succeed on a Starter plan", okCount === 3, `${okCount} succeeded`);
  record("capacity", "the 4th and 5th are refused with at_capacity",
    outcomes[3]?.includes("at_capacity") && outcomes[4]?.includes("at_capacity"),
    `${outcomes[3]} | ${outcomes[4]}`);

  const published = await admin(`/rest/v1/employer_jobs?org_id=eq.${orgId}&status=eq.published&select=id`);
  record("capacity", "the database holds exactly 3 published jobs", (published.json ?? []).length === 3,
    `count=${(published.json ?? []).length}`);

  const used = await admin(`/rest/v1/employer_job_post_credits?org_id=eq.${orgId}&select=total,used`);
  record("capacity", "exactly 3 credits were consumed", (used.json ?? [])[0]?.used === 3,
    JSON.stringify(used.json ?? used.text).slice(0, 160));

  // Closing a job frees capacity again.
  const firstPublished = (published.json ?? [])[0];
  if (firstPublished) {
    const closed = await call(owner, "PATCH", `/api/employer/orgs/${orgId}/jobs/${firstPublished.id}`, { action: "close" });
    record("capacity", "a published job can be closed", closed.status === 200, `status=${closed.status}`);

    const c = await call(owner, "POST", `/api/employer/orgs/${orgId}/jobs`, { title: "After Closing" });
    const id = c.json?.id ?? c.json?.job?.id;
    const p = await call(owner, "PATCH", `/api/employer/orgs/${orgId}/jobs/${id}`, { action: "publish" });
    record("capacity", "closing one frees exactly one slot", p.status === 200,
      `status=${p.status} ${JSON.stringify(p.json ?? p.text).slice(0, 140)}`);
  }

  // Re-publishing an already-published job must not consume a second credit.
  const somePublished = (await admin(`/rest/v1/employer_jobs?org_id=eq.${orgId}&status=eq.published&select=id`)).json ?? [];
  if (somePublished[0]) {
    const before = (await admin(`/rest/v1/employer_job_post_credits?org_id=eq.${orgId}&select=used`)).json?.[0]?.used;
    const re = await call(owner, "PATCH", `/api/employer/orgs/${orgId}/jobs/${somePublished[0].id}`, {
      title: "Renamed While Published",
    });
    const after = (await admin(`/rest/v1/employer_job_post_credits?org_id=eq.${orgId}&select=used`)).json?.[0]?.used;
    record("capacity", "editing a published job does not consume a second credit", before === after,
      `used ${before} -> ${after}, edit status=${re.status}`);
  }

  // A published job cannot go back to draft, and cannot be deleted.
  if (somePublished[0]) {
    const del = await call(owner, "PATCH", `/api/employer/orgs/${orgId}/jobs/${somePublished[0].id}`, { action: "delete" });
    record("capacity", "a published job cannot be deleted", del.status === 409, `status=${del.status}`);
  }
}

main()
  .then(() => { process.exitCode = summary() === 0 ? 0 : 1; })
  .catch((e) => { console.error("HARNESS ERROR:", e.message, e.stack); process.exitCode = 1; });
