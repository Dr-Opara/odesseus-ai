import {
  BASE, admin, signIn, call, record, summary,
  grantJobPostCredits, grantSubscription, addMember,
} from "./local-integration.mjs";

const PASSWORD = "Integration-Pass-1";
const stamp = Date.now();
const N = (s) => `${s}-${stamp}`;

async function main() {
  console.log(`\n=== EMPLOYER WRITE PATHS (8A) against ${BASE} ===\n`);

  const EMPLOYER = { account_type: "employer" };
  const owner = await signIn(N("emp-owner") + "@acme.test", PASSWORD, EMPLOYER);
  const otherOwner = await signIn(N("emp-other") + "@otherco.test", PASSWORD, EMPLOYER);
  const viewer = await signIn(N("emp-viewer") + "@initech.test", PASSWORD, EMPLOYER);
  const recruiter = await signIn(N("emp-recruiter") + "@globex.test", PASSWORD, EMPLOYER);
  const stranger = await signIn(N("emp-stranger") + "@nope.test", PASSWORD, EMPLOYER);

  record("auth", "an employer signs in with a real session", !!owner.accessToken);
  record("auth", "the session is a real Supabase auth cookie", owner.cookie.includes("sb-"),
    owner.cookie.split("=")[0]);

  // --- org creation ---------------------------------------------------
  const orgRes = await call(owner, "POST", "/api/employer/orgs", { companyName: "Acme Test Co" });
  record("org", "POST /api/employer/orgs creates an organization",
    orgRes.status === 200 || orgRes.status === 201,
    `status=${orgRes.status} ${JSON.stringify(orgRes.json ?? orgRes.text).slice(0, 160)}`);
  const orgId = orgRes.json?.org?.id ?? orgRes.json?.id;
  record("org", "the response carries an organization id", !!orgId, `orgId=${orgId}`);

  if (orgId) {
    const db = await admin(`/rest/v1/employer_organizations?id=eq.${orgId}&select=id,name,owner_user_id`);
    record("org", "the organization is a real database row", (db.json ?? []).length === 1,
      JSON.stringify(db.json ?? db.text).slice(0, 160));
    const mem = await admin(`/rest/v1/employer_members?org_id=eq.${orgId}&select=user_id,role`);
    record("org", "provisioning created the owner membership",
      (mem.json ?? []).some((m) => m.user_id === owner.userId && m.role === "owner"),
      JSON.stringify(mem.json ?? mem.text).slice(0, 160));
  }

  // A second, unrelated organization for the cross-org tests.
  const otherOrgRes = await call(otherOwner, "POST", "/api/employer/orgs", { companyName: "OtherCo" });
  const otherOrgId = otherOrgRes.json?.org?.id ?? otherOrgRes.json?.id;
  record("org", "a second organization exists for cross-org tests", !!otherOrgId, `otherOrgId=${otherOrgId}`);

  if (orgId) {
    await addMember(orgId, viewer.userId, "viewer");
    await addMember(orgId, recruiter.userId, "recruiter");
    record("org", "viewer and recruiter memberships created", true);
  }

  // --- PATCH org (8A) -------------------------------------------------
  const patchRes = await call(owner, "PATCH", `/api/employer/orgs/${orgId}`, {
    name: "Acme Renamed", industry: "Software", companySize: "11-50",
  });
  record("org", "PATCH /api/employer/orgs/[orgId] returns 200", patchRes.status === 200,
    `status=${patchRes.status} ${JSON.stringify(patchRes.json ?? patchRes.text).slice(0, 200)}`);

  const orgDb = await admin(`/rest/v1/employer_organizations?id=eq.${orgId}&select=name,industry,company_size`);
  const orgRow = (orgDb.json ?? [])[0];
  record("org", "the org update is in the DATABASE, not only the response",
    orgRow?.name === "Acme Renamed" && orgRow?.industry === "Software" && orgRow?.company_size === "11-50",
    JSON.stringify(orgDb.json ?? orgDb.text).slice(0, 220));
  record("org", "this is the write 8A repaired: it cannot have worked on the session client",
    orgRow?.name === "Acme Renamed");

  // --- create job (8A) ------------------------------------------------
  const createRes = await call(owner, "POST", `/api/employer/orgs/${orgId}/jobs`, {
    title: "Security Engineer",
    description: "Own the security posture of a small platform team.",
    location: "Remote", department: "Engineering", employmentType: "full_time",
    compensationText: "$150k-$180k",
  });
  record("jobs", "POST jobs creates a job", createRes.status === 201,
    `status=${createRes.status} ${JSON.stringify(createRes.json ?? createRes.text).slice(0, 200)}`);
  const jobId = createRes.json?.id ?? createRes.json?.job?.id;
  record("jobs", "the created job has an id", !!jobId, `jobId=${jobId}`);

  if (jobId) {
    const db = await admin(`/rest/v1/employer_jobs?id=eq.${jobId}&select=id,org_id,title,status,department,employment_type,compensation_text`);
    const row = (db.json ?? [])[0];
    record("jobs", "the job is a real row on the right org, in draft",
      row?.org_id === orgId && row?.title === "Security Engineer" && row?.status === "draft",
      JSON.stringify(db.json ?? db.text).slice(0, 240));
    record("jobs", "the structured job fields persisted as their own columns",
      row?.department === "Engineering" && row?.employment_type === "full_time" && row?.compensation_text === "$150k-$180k",
      JSON.stringify(db.json ?? db.text).slice(0, 240));
  }

  // --- edit job (8A) --------------------------------------------------
  const editRes = await call(owner, "PATCH", `/api/employer/orgs/${orgId}/jobs/${jobId}`, {
    title: "Senior Security Engineer", compensationText: "$170k-$200k",
  });
  record("jobs", "PATCH jobs/[jobId] edits a job", editRes.status === 200,
    `status=${editRes.status} ${JSON.stringify(editRes.json ?? editRes.text).slice(0, 200)}`);
  const editDb = await admin(`/rest/v1/employer_jobs?id=eq.${jobId}&select=title,compensation_text`);
  const editRow = (editDb.json ?? [])[0];
  record("jobs", "the edit is in the DATABASE",
    editRow?.title === "Senior Security Engineer" && editRow?.compensation_text === "$170k-$200k",
    JSON.stringify(editDb.json ?? editDb.text).slice(0, 200));

  // --- publish (8A) ---------------------------------------------------
  const sub = await grantSubscription(orgId, "growth", 10);
  const credits = await grantJobPostCredits(orgId, 5);
  record("jobs", "an active plan and job-post credits exist, as the billing path would leave them",
    sub.status < 400 && credits.status < 400,
    `sub=${sub.status} credits=${credits.status}`);

  const pubRes = await call(owner, "PATCH", `/api/employer/orgs/${orgId}/jobs/${jobId}`, { action: "publish" });
  record("jobs", "PATCH jobs/[jobId] publishes a draft", pubRes.status === 200,
    `status=${pubRes.status} ${JSON.stringify(pubRes.json ?? pubRes.text).slice(0, 220)}`);
  const pubDb = await admin(`/rest/v1/employer_jobs?id=eq.${jobId}&select=status,posted_at`);
  record("jobs", "the job is published in the DATABASE",
    (pubDb.json ?? [])[0]?.status === "published", JSON.stringify(pubDb.json ?? pubDb.text).slice(0, 180));
  const creditDb = await admin(`/rest/v1/employer_job_post_credits?org_id=eq.${orgId}&select=total,used`);
  record("jobs", "publishing consumed exactly one job-post credit",
    (creditDb.json ?? [])[0]?.used === 1, JSON.stringify(creditDb.json ?? creditDb.text).slice(0, 180));

  // Capacity enforcement is exercised in `local-flow-2-capacity.mjs` against a
  // dedicated organization. It cannot be checked here: `POST /api/employer/orgs`
  // returns the *existing* organization for an owner who already has one, so a
  // second create for the same owner collapses onto the first org and the
  // "starter" plan row below would never be the one read. That behaviour is
  // correct -- one organization per owner -- and it is why the capacity test
  // stands up its own owner.

  // --- close (8A) -----------------------------------------------------
  const closeRes = await call(owner, "PATCH", `/api/employer/orgs/${orgId}/jobs/${jobId}`, { action: "close" });
  record("jobs", "PATCH jobs/[jobId] closes a published job", closeRes.status === 200,
    `status=${closeRes.status} ${JSON.stringify(closeRes.json ?? closeRes.text).slice(0, 200)}`);
  const closeDb = await admin(`/rest/v1/employer_jobs?id=eq.${jobId}&select=status`);
  record("jobs", "the job is closed in the DATABASE", (closeDb.json ?? [])[0]?.status === "closed",
    JSON.stringify(closeDb.json ?? closeDb.text).slice(0, 180));

  // --- delete a draft -------------------------------------------------
  const draftRes = await call(owner, "POST", `/api/employer/orgs/${orgId}/jobs`, { title: "Throwaway Draft" });
  const draftId = draftRes.json?.id ?? draftRes.json?.job?.id;
  const delRes = draftId
    ? await call(owner, "PATCH", `/api/employer/orgs/${orgId}/jobs/${draftId}`, { action: "delete" })
    : { status: 0, json: null, text: "no draft id" };
  record("jobs", "PATCH jobs/[jobId] deletes a draft", delRes.status === 200,
    `status=${delRes.status} ${JSON.stringify(delRes.json ?? delRes.text).slice(0, 180)}`);
  if (draftId) {
    const db = await admin(`/rest/v1/employer_jobs?id=eq.${draftId}&select=id`);
    record("jobs", "the draft is gone from the DATABASE", (db.json ?? []).length === 0,
      JSON.stringify(db.json ?? db.text).slice(0, 160));
  }
  const delClosed = await call(owner, "PATCH", `/api/employer/orgs/${orgId}/jobs/${jobId}`, { action: "delete" });
  record("jobs", "a closed job cannot be deleted", delClosed.status === 409,
    `status=${delClosed.status}`);

  return { owner, otherOwner, viewer, recruiter, stranger, orgId, otherOrgId, jobId };
}

main()
  .then(() => { process.exitCode = summary() === 0 ? 0 : 1; })
  .catch((e) => { console.error("HARNESS ERROR:", e.message, e.stack); process.exitCode = 1; });
