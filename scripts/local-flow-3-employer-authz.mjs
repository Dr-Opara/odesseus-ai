import {
  BASE, admin, signIn, call, record, summary,
  grantJobPostCredits, grantSubscription, addMember,
} from "./local-integration.mjs";

const PASSWORD = "Integration-Pass-1";
const N = (s) => `${s}-${Date.now()}`;

async function main() {
  console.log(`\n=== EMPLOYER WRITE AUTHORIZATION MATRIX (8A) ===\n`);

  const E = { account_type: "employer" };
  const owner = await signIn(N("am-owner") + "@a.test", PASSWORD, E);
  const adminUser = await signIn(N("am-admin") + "@a.test", PASSWORD, E);
  const recruiter = await signIn(N("am-recruiter") + "@a.test", PASSWORD, E);
  const viewer = await signIn(N("am-viewer") + "@a.test", PASSWORD, E);
  const outsider = await signIn(N("am-outsider") + "@b.test", PASSWORD, E);
  const candidate = await signIn(N("am-cand") + "@example.com", PASSWORD);

  const orgRes = await call(owner, "POST", "/api/employer/orgs", { companyName: "Matrix Co" });
  const orgId = orgRes.json?.org?.id ?? orgRes.json?.id;
  record("matrix", "organization created", !!orgId, `orgId=${orgId}`);

  // A second org the outsider genuinely owns, for cross-org attempts.
  const otherRes = await call(outsider, "POST", "/api/employer/orgs", { companyName: "Other Matrix Co" });
  const otherOrgId = otherRes.json?.org?.id ?? otherRes.json?.id;
  record("matrix", "a second, unrelated organization exists", !!otherOrgId, `otherOrgId=${otherOrgId}`);

  await addMember(orgId, adminUser.userId, "admin");
  await addMember(orgId, recruiter.userId, "recruiter");
  await addMember(orgId, viewer.userId, "viewer");
  await grantSubscription(orgId, "growth", 10);
  await grantJobPostCredits(orgId, 20);

  // A victim job inside the org, owned by the owner.
  const victim = await call(owner, "POST", `/api/employer/orgs/${orgId}/jobs`, { title: "Victim Job" });
  const victimId = victim.json?.id ?? victim.json?.job?.id;
  await call(owner, "PATCH", `/api/employer/orgs/${orgId}/jobs/${victimId}`, { action: "publish" });
  record("matrix", "a published victim job exists to attack", !!victimId, `jobId=${victimId}`);

  const before = (await admin(`/rest/v1/employer_jobs?id=eq.${victimId}&select=title,status`)).json?.[0];

  // --- who may CREATE ------------------------------------------------
  // The documented contract: job writes are owner + admin. `recruiter` and
  // `viewer` are both refused, and a Fit Score / pipeline transition is the
  // recruiter's privilege, not a job write.
  for (const [label, who, expect] of [
    ["owner", owner, 201],
    ["admin", adminUser, 201],
    ["recruiter", recruiter, 403],
    ["viewer", viewer, 403],
  ]) {
    const r = await call(who, "POST", `/api/employer/orgs/${orgId}/jobs`, { title: `By ${label}` });
    record("create", `${label} create -> ${expect}`, r.status === expect, `status=${r.status}`);
  }

  // --- who may EDIT ---------------------------------------------------
  for (const [label, who, expect] of [
    ["admin", adminUser, 200],
    ["recruiter", recruiter, 403],
  ]) {
    const target = await call(owner, "POST", `/api/employer/orgs/${orgId}/jobs`, { title: `Edit by ${label}` });
    const id = target.json?.id ?? target.json?.job?.id;
    const r = await call(who, "PATCH", `/api/employer/orgs/${orgId}/jobs/${id}`, { title: `Edited by ${label}` });
    const row = (await admin(`/rest/v1/employer_jobs?id=eq.${id}&select=title`)).json?.[0];
    const persisted = row?.title === `Edited by ${label}`;
    record("edit", `${label} edit -> ${expect}`,
      r.status === expect && (expect === 403 ? !persisted : persisted),
      `status=${r.status} dbTitle=${row?.title}`);
  }

  // --- viewer must not mutate anything --------------------------------
  const viewerAttempts = [
    ["create a job", viewer, "POST", `/api/employer/orgs/${orgId}/jobs`, { title: "Viewer Job" }],
    ["edit a job", viewer, "PATCH", `/api/employer/orgs/${orgId}/jobs/${victimId}`, { title: "Viewer Edit" }],
    ["publish a job", viewer, "PATCH", `/api/employer/orgs/${orgId}/jobs/${victimId}`, { action: "publish" }],
    ["close a job", viewer, "PATCH", `/api/employer/orgs/${orgId}/jobs/${victimId}`, { action: "close" }],
    ["delete a job", viewer, "PATCH", `/api/employer/orgs/${orgId}/jobs/${victimId}`, { action: "delete" }],
    ["edit the org", viewer, "PATCH", `/api/employer/orgs/${orgId}`, { name: "Viewer Renamed" }],
  ];
  for (const [label, who, method, path, body] of viewerAttempts) {
    const r = await call(who, method, path, body);
    record("viewer", `a viewer cannot ${label}`, r.status === 403 || r.status === 404,
      `status=${r.status} ${JSON.stringify(r.json ?? r.text).slice(0, 120)}`);
  }

  const after = (await admin(`/rest/v1/employer_jobs?id=eq.${victimId}&select=title,status`)).json?.[0];
  record("viewer", "the victim job is byte-for-byte unchanged after every viewer attempt",
    after?.title === before?.title && after?.status === before?.status,
    `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);

  // --- unrelated org cannot mutate ------------------------------------
  const otherTarget = await call(outsider, "POST", `/api/employer/orgs/${otherOrgId}/jobs`, { title: "Outsider Job" });
  const otherJobId = otherTarget.json?.id ?? otherTarget.json?.job?.id;
  record("crossorg", "the outsider created a job in their own org", !!otherJobId);

  const crossAttempts = [
    ["a non-member cannot create in another org", owner, "POST", `/api/employer/orgs/${otherOrgId}/jobs`, { title: "Intruder" }],
    ["a non-member cannot edit another org's job", owner, "PATCH", `/api/employer/orgs/${otherOrgId}/jobs/${otherJobId}`, { title: "Intruder" }],
    ["a member of A cannot edit a job in B", recruiter, "PATCH", `/api/employer/orgs/${otherOrgId}/jobs/${otherJobId}`, { title: "Intruder" }],
    ["a member of A cannot publish a job in B", recruiter, "PATCH", `/api/employer/orgs/${otherOrgId}/jobs/${otherJobId}`, { action: "publish" }],
    ["a member of A cannot close a job in B", recruiter, "PATCH", `/api/employer/orgs/${otherOrgId}/jobs/${otherJobId}`, { action: "close" }],
    ["a member of A cannot edit org B", recruiter, "PATCH", `/api/employer/orgs/${otherOrgId}`, { name: "Intruder" }],
  ];
  for (const [label, who, method, path, body] of crossAttempts) {
    const r = await call(who, method, path, body);
    record("crossorg", label, r.status === 403 || r.status === 404,
      `status=${r.status} ${JSON.stringify(r.json ?? r.text).slice(0, 120)}`);
  }

  const otherRow = (await admin(`/rest/v1/employer_jobs?id=eq.${otherJobId}&select=title,status`)).json?.[0];
  record("crossorg", "org B's job is unchanged by org A's members",
    otherRow?.title === "Outsider Job" && otherRow?.status === "draft",
    JSON.stringify(otherRow));

  // --- forged / nonexistent ids ----------------------------------------
  const forged = [
    ["a forged org id", owner, "POST", "/api/employer/orgs/00000000-0000-4000-8000-000000009999/jobs", { title: "Forged" }],
    ["a nonexistent org id", owner, "PATCH", "/api/employer/orgs/00000000-0000-4000-8000-000000009999", { name: "Forged" }],
    ["a non-uuid org id", owner, "POST", "/api/employer/orgs/not-a-uuid/jobs", { title: "Forged" }],
    ["a non-uuid org id on notifications", owner, "GET", "/api/employer/orgs/not-a-uuid/notifications", undefined],
    ["a non-uuid org id on team", owner, "GET", "/api/employer/orgs/not-a-uuid/team", undefined],
    ["a job id that does not exist", owner, "PATCH", `/api/employer/orgs/${orgId}/jobs/00000000-0000-4000-8000-000000009998`, { action: "publish" }],
    ["a job id from another org", owner, "PATCH", `/api/employer/orgs/${orgId}/jobs/${otherJobId}`, { action: "publish" }],
  ];
  for (const [label, who, method, path, body] of forged) {
    const r = await call(who, method, path, body);
    // Specifically NOT 500: a malformed path segment used to reach the database
    // and come back as an unhandled query error, which reads as a server fault
    // rather than as "that is not an organization".
    record("forged", `${label} is refused, not a 500`, r.status >= 400 && r.status < 500,
      `status=${r.status} ${JSON.stringify(r.json ?? r.text).slice(0, 110)}`);
  }

  // --- anonymous -------------------------------------------------------
  const anon = async (method, path, body) => {
    const r = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    return { status: r.status, text: (await r.text()).slice(0, 80) };
  };
  const anonAttempts = [
    ["create a job", "POST", `/api/employer/orgs/${orgId}/jobs`, { title: "Anon" }],
    ["edit a job", "PATCH", `/api/employer/orgs/${orgId}/jobs/${victimId}`, { title: "Anon" }],
    ["publish a job", "PATCH", `/api/employer/orgs/${orgId}/jobs/${victimId}`, { action: "publish" }],
    ["edit the org", "PATCH", `/api/employer/orgs/${orgId}`, { name: "Anon" }],
  ];
  for (const [label, method, path, body] of anonAttempts) {
    const r = await anon(method, path, body);
    record("anonymous", `an anonymous caller cannot ${label}`,
      r.status === 307 || r.status === 401 || r.status === 403 || r.status === 404,
      `status=${r.status}`);
  }

  // --- a candidate cannot reach an employer write ----------------------
  for (const [label, method, path, body] of [
    ["create a job", "POST", `/api/employer/orgs/${orgId}/jobs`, { title: "Cand" }],
    ["edit the org", "PATCH", `/api/employer/orgs/${orgId}`, { name: "Cand" }],
    ["publish", "PATCH", `/api/employer/orgs/${orgId}/jobs/${victimId}`, { action: "publish" }],
  ]) {
    const r = await call(candidate, method, path, body);
    record("candidate", `a plain candidate cannot ${label} through an employer route`,
      r.status === 403 || r.status === 404, `status=${r.status}`);
  }

  // --- the org PATCH is owner-only -------------------------------------
  const adminPatch = await call(adminUser, "PATCH", `/api/employer/orgs/${orgId}`, { name: "Admin Renamed" });
  record("orgpatch", "an admin cannot edit the org profile (owner only)", adminPatch.status === 403,
    `status=${adminPatch.status}`);
  const ownerPatch = await call(owner, "PATCH", `/api/employer/orgs/${orgId}`, { name: "Owner Renamed" });
  record("orgpatch", "the owner can edit the org profile", ownerPatch.status === 200, `status=${ownerPatch.status}`);
  const finalName = (await admin(`/rest/v1/employer_organizations?id=eq.${orgId}&select=name`)).json?.[0]?.name;
  record("orgpatch", "the owner's change is in the database", finalName === "Owner Renamed", `name=${finalName}`);
}

main()
  .then(() => { process.exitCode = summary() === 0 ? 0 : 1; })
  .catch((e) => { console.error("HARNESS ERROR:", e.message, e.stack); process.exitCode = 1; });
