import { readFileSync } from "node:fs";
import {
  BASE, admin, signIn, call, record, summary,
  grantJobPostCredits, grantSubscription, addMember,
} from "./local-integration.mjs";

const PASSWORD = "Integration-Pass-1";
const N = (s) => `${s}-${Date.now()}`;

async function main() {
  console.log(`\n=== EMPLOYER READ SURFACES (8C) ===\n`);

  const E = { account_type: "employer" };
  const owner = await signIn(N("rd-owner") + "@r.test", PASSWORD, E);
  const viewer = await signIn(N("rd-viewer") + "@r.test", PASSWORD, E);
  const recruiter = await signIn(N("rd-recruiter") + "@r.test", PASSWORD, E);

  const orgRes = await call(owner, "POST", "/api/employer/orgs", { companyName: "Reads Co" });
  const orgId = orgRes.json?.org?.id ?? orgRes.json?.id;
  record("reads", "organization created", !!orgId, `orgId=${orgId}`);

  await addMember(orgId, viewer.userId, "viewer");
  await addMember(orgId, recruiter.userId, "recruiter");
  await grantSubscription(orgId, "growth", 10);
  await grantJobPostCredits(orgId, 20);

  // A published job with a real applicant on it.
  const job = await call(owner, "POST", `/api/employer/orgs/${orgId}/jobs`, {
    title: "Platform Engineer", description: "Build the platform.", location: "Remote",
  });
  const jobId = job.json?.id ?? job.json?.job?.id;
  await call(owner, "PATCH", `/api/employer/orgs/${orgId}/jobs/${jobId}`, { action: "publish" });

  // A real candidate, and a real application to this job.
  const candidate = await signIn(N("applicant") + "@example.com", PASSWORD);
  await admin("/rest/v1/profiles", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ id: candidate.userId, full_name: "Grace Hopper" }),
  });
  const jobOpportunity = await admin("/rest/v1/job_opportunities", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: candidate.userId, role_title: "Platform Engineer", company_name: "Reads Co",
      status: "applied", employer_job_id: jobId,
    }),
  });
  const opportunityId = jobOpportunity.json?.[0]?.id;
  record("reads", "a candidate tracked this job", !!opportunityId, `opportunityId=${opportunityId}`);

  const application = await admin("/rest/v1/applications", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: candidate.userId, job_id: opportunityId, company_name: "Reads Co",
      role_title: "Platform Engineer", status: "approved",
    }),
  });
  const applicationId = application.json?.[0]?.id;
  record("reads", "a real application exists on the job", !!applicationId, `applicationId=${applicationId}`);

  // --- candidates list / detail ---------------------------------------
  const list = await call(recruiter, "GET", `/api/employer/orgs/${orgId}/candidates?jobId=${jobId}`);
  record("candidates", "GET candidates returns the applicant", list.status === 200 && (list.json?.applicants ?? []).length === 1,
    `status=${list.status} ${JSON.stringify(list.json ?? list.text).slice(0, 200)}`);

  const first = list.json?.applicants?.[0];
  record("candidates", "the applicant carries their real name from the identity reader",
    first?.candidateName === "Grace Hopper", `name=${first?.candidateName}`);
  record("candidates", "the list response does NOT contain the resume snapshot",
    !JSON.stringify(list.json).includes("resumeSnapshot"), "");
  record("candidates", "the list response does NOT contain a user id",
    !JSON.stringify(list.json).includes(candidate.userId), "");

  if (first?.applicationId) {
    const detail = await call(recruiter, "GET", `/api/employer/orgs/${orgId}/candidates/${first.applicationId}`);
    record("candidates", "GET candidate detail returns 200", detail.status === 200,
      `status=${detail.status} ${JSON.stringify(detail.json ?? detail.text).slice(0, 160)}`);
    record("candidates", "candidate detail does not leak a user id",
      !JSON.stringify(detail.json).includes(candidate.userId), "");
  }

  const viewerList = await call(viewer, "GET", `/api/employer/orgs/${orgId}/candidates?jobId=${jobId}`);
  record("candidates", "a viewer can read candidates (read-only role)",
    viewerList.status === 200, `status=${viewerList.status}`);

  // --- Fit Score -------------------------------------------------------
  const fit = await call(recruiter, "POST", `/api/employer/orgs/${orgId}/candidates/${first?.applicationId}/fit-score`, { jobId });
  const hasKey = !!process.env.OPENAI_API_KEY;
  if (hasKey) {
    record("fit", "a recruiter can generate a Fit Score", fit.status === 200,
      `status=${fit.status} ${JSON.stringify(fit.json ?? fit.text).slice(0, 200)}`);
    record("fit", "the score came back as a number", typeof fit.json?.score === "number",
      `score=${JSON.stringify(fit.json?.score)}`);
  } else {
    // Authorization is still fully exercised: the recruiter passes the role
    // check and reaches the model call, which is exactly how far this can go
    // without a key. The viewer is refused before that, by role.
    record("fit", "a recruiter passes the role check and reaches the model call (no OPENAI_API_KEY, 8F blocker)",
      fit.status === 500 && /Could not score/.test(JSON.stringify(fit.json ?? fit.text)),
      `status=${fit.status} ${JSON.stringify(fit.json ?? fit.text).slice(0, 160)}`);
    record("fit", "the refusal is the model failing, not authorization", fit.status !== 403 && fit.status !== 404,
      `status=${fit.status}`);
  }

  const viewerFit = await call(viewer, "POST", `/api/employer/orgs/${orgId}/candidates/${first?.applicationId}/fit-score`, { jobId });
  record("fit", "a viewer cannot generate a Fit Score", viewerFit.status === 403,
    `status=${viewerFit.status} ${JSON.stringify(viewerFit.json ?? viewerFit.text).slice(0, 120)}`);

  // --- pipeline --------------------------------------------------------
  const pipe = await call(recruiter, "GET", `/api/employer/orgs/${orgId}/pipeline`);
  record("pipeline", "GET pipeline returns 200", pipe.status === 200,
    `status=${pipe.status} ${JSON.stringify(pipe.json ?? pipe.text).slice(0, 160)}`);

  // The GET returns the current placement and the history, not a catalogue of
  // stages, so the stage vocabulary comes from the catalog rather than the read.
  const stages = (pipe.json?.history ?? []).map((h) => h.stage);
  record("pipeline", "the pipeline read returns the current placement and history",
    pipe.json && "current" in pipe.json && "history" in pipe.json,
    JSON.stringify(pipe.json).slice(0, 180));
  // Read from the backend's own constant rather than guessed, so a vocabulary
  // change in `hiring.ts` cannot make this test pass vacuously. The uppercase
  // copy in `lib/employers/types.ts` is the product surface; `stages.ts` owns
  // the mapping between them, and the route speaks the lowercase form.
  const STAGE_VOCABULARY = [...readFileSync("src/lib/employer/hiring.ts", "utf8")
    .match(/PIPELINE_STAGES = \[([\s\S]*?)\] as const;/)[1]
    .matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

  {
    // The first stage after `applied`, so the transition is a legal forward move.
    const target = STAGE_VOCABULARY.find((s) => s !== "applied") ?? STAGE_VOCABULARY[0];
    record("pipeline", "the pipeline stage vocabulary is readable", Array.isArray(STAGE_VOCABULARY) && STAGE_VOCABULARY.length > 0,
      JSON.stringify(STAGE_VOCABULARY));
    // `jobId` is required by the transition schema, and the service
    // re-verifies the application belongs to that job, so it is part of the
    // check being exercised rather than a formality.
    const move = await call(recruiter, "POST", `/api/employer/orgs/${orgId}/pipeline`, {
      jobId, applicationId: first?.applicationId, stage: target,
    });
    record("pipeline", "a recruiter can move a stage", move.status === 200,
      `stage=${target} status=${move.status} ${JSON.stringify(move.json ?? move.text).slice(0, 160)}`);

    const rows = await admin(`/rest/v1/employer_pipeline_stages?application_id=eq.${first?.applicationId}&select=stage&order=created_at.desc&limit=1`);
    record("pipeline", "the stage change is in the DATABASE",
      (rows.json ?? [])[0]?.stage === target, JSON.stringify(rows.json ?? rows.text).slice(0, 160));

    const viewerMove = await call(viewer, "POST", `/api/employer/orgs/${orgId}/pipeline`, {
      jobId, applicationId: first?.applicationId, stage: target,
    });
    record("pipeline", "a viewer cannot move a stage", viewerMove.status === 403, `status=${viewerMove.status}`);

    // The attribution edge: a job the application does not belong to.
    const strangerJob = await call(owner, "POST", `/api/employer/orgs/${orgId}/jobs`, { title: "Unrelated Job" });
    const strangerJobId = strangerJob.json?.id ?? strangerJob.json?.job?.id;
    const wrongJob = await call(recruiter, "POST", `/api/employer/orgs/${orgId}/pipeline`, {
      jobId: strangerJobId, applicationId: first?.applicationId, stage: target,
    });
    record("pipeline", "a transition against the wrong job is refused", wrongJob.status === 404,
      `status=${wrongJob.status} ${JSON.stringify(wrongJob.json ?? wrongJob.text).slice(0, 120)}`);

    // A stage outside the vocabulary.
    const badStage = await call(recruiter, "POST", `/api/employer/orgs/${orgId}/pipeline`, {
      jobId, applicationId: first?.applicationId, stage: "hired_immediately",
    });
    record("pipeline", "a stage outside the vocabulary is refused", badStage.status === 400,
      `status=${badStage.status}`);

    // A second, different transition appends rather than overwrites.
    const nextStage = STAGE_VOCABULARY.find((s) => s !== "applied" && s !== target);
    if (nextStage) {
      const again = await call(recruiter, "POST", `/api/employer/orgs/${orgId}/pipeline`, {
        jobId, applicationId: first?.applicationId, stage: nextStage,
      });
      const all = await admin(
        `/rest/v1/employer_pipeline_stages?application_id=eq.${first?.applicationId}&select=stage&order=created_at.asc`);
      const stagesSeen = (all.json ?? []).map((r) => r.stage);
      record("pipeline", "history is append-only, so both transitions are preserved",
        again.status === 200 && stagesSeen.length === 2 && stagesSeen[1] === nextStage,
        `status=${again.status} history=${JSON.stringify(stagesSeen)}`);

      const current = await call(recruiter, "GET", `/api/employer/orgs/${orgId}/pipeline?jobId=${jobId}`);
      record("pipeline", "the current stage is the latest row, not the first",
        current.json?.current?.[first?.applicationId] === nextStage,
        JSON.stringify(current.json?.current).slice(0, 160));
    }
  }

  // --- analytics / dashboard / team / billing / notifications ----------
  for (const [label, path, expect] of [
    ["analytics", `/api/employer/orgs/${orgId}/analytics`, 200],
    ["dashboard", `/api/employer/orgs/${orgId}/dashboard`, 200],
    ["team", `/api/employer/orgs/${orgId}/team`, 200],
    ["billing", `/api/employer/orgs/${orgId}/billing`, 200],
    ["notifications", `/api/employer/orgs/${orgId}/notifications`, 200],
    ["notification preferences", `/api/employer/orgs/${orgId}/notification-preferences`, 200],
    ["featured", `/api/employer/orgs/${orgId}/featured`, 200],
  ]) {
    const r = await call(recruiter, "GET", path);
    record("surfaces", `GET ${label} -> ${expect}`, r.status === expect,
      `status=${r.status} ${JSON.stringify(r.json ?? r.text).slice(0, 130)}`);
  }

  const analytics = await call(recruiter, "GET", `/api/employer/orgs/${orgId}/analytics`);
  if (analytics.status === 200) {
    const text = JSON.stringify(analytics.json);
    record("surfaces", "analytics does not leak candidate private data",
      !text.includes("stripe_customer_id") && !text.includes(candidate.userId), "");
  }

  const team = await call(recruiter, "GET", `/api/employer/orgs/${orgId}/team`);
  if (team.status === 200) {
    const text = JSON.stringify(team.json);
    record("surfaces", "team does not leak Stripe ids", !text.toLowerCase().includes("stripe"), "");
  }

  // --- 8B: the recruiter seat checkout contract ------------------------
  console.log(`\n=== RECRUITER SEAT CHECKOUT CONTRACT (8B) ===\n`);

  const seatPath = `/api/employer/orgs/${orgId}/seats/checkout`;

  // What the callers used to send.
  const wrong = await call(owner, "POST", seatPath, { seats: 3 });
  record("seats", "the old `seats` field is still refused with 400", wrong.status === 400,
    `status=${wrong.status} ${JSON.stringify(wrong.json ?? wrong.text).slice(0, 120)}`);

  // What they send now.
  const right = await call(owner, "POST", seatPath, { seatCount: 3 });
  record("seats", "the `seatCount` field passes schema validation", right.status !== 400,
    `status=${right.status} ${JSON.stringify(right.json ?? right.text).slice(0, 160)}`);
  record("seats", "with no STRIPE_SECRET_KEY it fails honestly as 'not configured', not 400",
    right.status === 503, `status=${right.status} ${JSON.stringify(right.json ?? right.text).slice(0, 120)}`);

  for (const [label, body, ok] of [
    ["zero seats", { seatCount: 0 }, false],
    ["a fractional seat", { seatCount: 1.5 }, false],
    ["more than the maximum", { seatCount: 101 }, false],
    ["a string instead of a number", { seatCount: "3" }, false],
    ["one seat", { seatCount: 1 }, true],
    ["the maximum", { seatCount: 100 }, true],
  ]) {
    const r = await call(owner, "POST", seatPath, body);
    const passed = r.status !== 400;
    record("seats", `${label} ${ok ? "is accepted by the schema" : "is refused"}`,
      passed === ok, `status=${r.status} ${JSON.stringify(r.json ?? r.text).slice(0, 110)}`);
  }

  // A viewer must not be able to start a checkout at all.
  const viewerSeat = await call(viewer, "POST", seatPath, { seatCount: 1 });
  record("seats", "a viewer cannot start a seat checkout", viewerSeat.status === 403,
    `status=${viewerSeat.status} ${JSON.stringify(viewerSeat.json ?? viewerSeat.text).slice(0, 110)}`);

  // Nor a non-member.
  const outsider = await signIn(N("seat-outsider") + "@x.test", PASSWORD, E);
  const outsiderSeat = await call(outsider, "POST", seatPath, { seatCount: 1 });
  record("seats", "a non-member cannot start a seat checkout",
    outsiderSeat.status === 404 || outsiderSeat.status === 403,
    `status=${outsiderSeat.status}`);

  // And the catalog price the route derives.
  // The employer SKUs are deliberately not in the `pricing_products` table --
  // the catalog says so itself: they are sold through Stripe checkouts and
  // exported from the TS catalog so the webhook can verify paid amounts. So the
  // price is asserted where it actually lives.
  const catalogText = readFileSync("src/lib/billing/catalog.ts", "utf8");

  const seatPrice = Number(
    catalogText.match(/export const employerRecruiterSeat[\s\S]*?amountCents:\s*(\d+)/)?.[1]
  );
  record("seats", "the recruiter seat is $20.00", seatPrice === 2000, `amountCents=${seatPrice}`);
  record("seats", "the catalog describes it as a monthly per-seat charge",
    /billed monthly per seat/.test(catalogText));

  // Key names are not asserted: the third tier is `ai_30d` in the source, and
  // matching on names would silently skip it. The whole block is read so a
  // rename cannot make this quietly match fewer tiers than it claims to.
  const featuredBlock = catalogText.slice(
    catalogText.indexOf("export const employerFeaturedTiers"),
    catalogText.indexOf("export type EmployerFeaturedTier"));
  const featured = [...featuredBlock.matchAll(/amountCents:\s*(\d+),\s*\n\s*days:\s*(\d+)/g)]
    .map((m) => ({ cents: Number(m[1]), days: Number(m[2]) }));
  record("seats", "featured tiers are $29 / $49 / $129 for 7 / 14 / 30 days",
    featured.length === 3
      && JSON.stringify(featured.map((f) => f.cents)) === JSON.stringify([2900, 4900, 12900])
      && JSON.stringify(featured.map((f) => f.days)) === JSON.stringify([7, 14, 30]),
    JSON.stringify(featured));

  const planPrices = [...catalogText.matchAll(/(starter|growth|business): \{[\s\S]*?amountCents:\s*(\d+)/g)]
    .map((m) => ({ tier: m[1], cents: Number(m[2]) }));
  record("seats", "employer plans are $79 / $149 / $299",
    planPrices.length >= 3 && planPrices[0].cents === 7900
      && planPrices[1].cents === 14900 && planPrices[2].cents === 29900,
    JSON.stringify(planPrices.slice(0, 3)));
}

main()
  .then(() => { process.exitCode = summary() === 0 ? 0 : 1; })
  .catch((e) => { console.error("HARNESS ERROR:", e.message, e.stack); process.exitCode = 1; });
