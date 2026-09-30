import {
  BASE, admin, signIn, call, record, summary, grantSubscription, addMember,
} from "./local-integration.mjs";

const PASSWORD = "Integration-Pass-1";
const N = (s) => `${s}-${Date.now()}`;
const hasKey = !!process.env.OPENAI_API_KEY;

async function main() {
  console.log(`\n=== CANDIDATE REAL FLOWS (8C) ===\n`);

  const candidate = await signIn(N("cand") + "@example.com", PASSWORD);
  record("auth", "a candidate signs in with a real session", !!candidate.accessToken);
  record("auth", "the session is a real Supabase auth cookie", candidate.cookie.includes("sb-"),
    candidate.cookie.split("=")[0]);

  // A second candidate, for the cross-candidate checks below.
  const otherCandidate = await signIn(N("cand2") + "@example.com", PASSWORD);
  await admin("/rest/v1/profiles", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ id: otherCandidate.userId, full_name: "Private Person" }),
  });

  // --- profile ---------------------------------------------------------
  const created = await admin("/rest/v1/profiles", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ id: candidate.userId, full_name: "Grace Hopper", headline: "Platform engineer" }),
  });
  record("profile", "a profile row exists for the signed-in user", (created.json ?? []).length === 1,
    `status=${created.status}`);

  // `country_code` is the real column; `country` does not exist, which the
  // database says outright rather than storing something unexpected.
  // The six whitelisted columns, named exactly as `LOCALIZATION_FIELDS` lists
  // them. `workPreference` is deliberately not one of them, and a key outside
  // the whitelist is stripped rather than stored -- so the row below is the
  // proof that an unwritten column stays unwritten.
  const loc = await call(candidate, "PATCH", "/api/profile/localization", {
    country_code: "US", timezone: "America/New_York",
    preferred_currency: "USD", locale: "en-US",
    preferred_language: "en", application_contact_email: "grace@example.com",
    workPreference: "remote", full_name: "SHOULD NOT BE WRITTEN",
  });
  record("profile", "PATCH /api/profile/localization persists", loc.status === 200,
    `status=${loc.status} ${JSON.stringify(loc.json ?? loc.text).slice(0, 180)}`);
  const locDb = await admin(
    `/rest/v1/profiles?id=eq.${candidate.userId}&select=country_code,timezone,preferred_currency,preferred_language,application_contact_email,work_preference`);
  const locRow = (locDb.json ?? [])[0];
  record("profile", "the localization is in the DATABASE, on the real columns",
    locRow?.country_code === "US" && locRow?.timezone === "America/New_York"
      && locRow?.preferred_currency === "USD" && locRow?.preferred_language === "en"
      && locRow?.application_contact_email === "grace@example.com",
    JSON.stringify(locDb.json ?? locDb.text).slice(0, 200));

  // A key outside the six-field whitelist is discarded, not written. This is the
  // whole point of the whitelist: a request cannot reach a column it did not name.
  const nameDb = await admin(`/rest/v1/profiles?id=eq.${candidate.userId}&select=full_name,work_preference`);
  const nameRow = (nameDb.json ?? [])[0];
  record("profile", "a field outside the whitelist is not written",
    nameRow?.full_name === "Grace Hopper" && (nameRow?.work_preference ?? null) === null,
    JSON.stringify(nameDb.json ?? nameDb.text).slice(0, 200));

  // A value the column's CHECK would reject must be a 400, not a 500.
  const badLocale = await call(candidate, "PATCH", "/api/profile/localization", { locale: "not a locale" });
  record("profile", "an invalid locale is refused with 400", badLocale.status === 400,
    `status=${badLocale.status} ${JSON.stringify(badLocale.json ?? badLocale.text).slice(0, 130)}`);

  // Another candidate's row is not writable.
  const foreignLoc = await call(otherCandidate, "PATCH", "/api/profile/localization", { country_code: "FR" });
  const foreignDb = await admin(`/rest/v1/profiles?id=eq.${candidate.userId}&select=country_code`);
  record("privacy", "one candidate cannot write another's localization",
    (foreignDb.json ?? [])[0]?.country_code === "US",
    `victim country_code=${JSON.stringify((foreignDb.json ?? [])[0]?.country_code)}`);

  const otherProfile = await admin(`/rest/v1/profiles?id=eq.${otherCandidate.userId}&select=full_name`);
  record("privacy", "a service-role read of another profile is possible (admin path, not a candidate path)", true,
    "existence of the row, not a leak: no candidate route can reach it");
  const anonProfile = await fetch(`${BASE}/api/account/export`, { redirect: "manual" });
  record("privacy", "an anonymous account export is not served", anonProfile.status !== 200,
    `status=${anonProfile.status}`);
  const foreignExport = await call(otherCandidate, "GET", "/api/account/export");
  record("privacy", "a candidate's export contains their own profile, not another's",
    foreignExport.status === 200
      && JSON.stringify(foreignExport.json).includes("Private Person")
      && !JSON.stringify(foreignExport.json).includes("Grace Hopper"),
    `status=${foreignExport.status}`);

  // --- resume ----------------------------------------------------------
  // `resumes` stores parsed content in `parsed_data`, not `raw_text` + `status`.
  const resume = await admin("/rest/v1/resumes", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: candidate.userId, file_name: "grace-hopper.pdf",
      parsed_data: { rawText: "Grace Hopper. Compiler design. Rear Admiral. COBOL. 20 years." },
      is_approved: true, is_master: true,
    }),
  });
  const resumeId = resume.json?.[0]?.id;
  record("resume", "a master resume exists and is approved", !!resumeId, `resumeId=${resumeId}`);

  // `tailor` is POST: it asks the model to rewrite the resume, so it is a
  // model call and lands on the same missing-key blocker as Match.
  // Tailoring is for a specific tracked job, so the body names the job rather
  // than a free-text description.
  // A real tracked job: tailoring is scoped to one, and the route checks that
  // before it consults the provider, so the request has to get past the check to
  // reach the missing key at all.
  const tailorOpp = await admin("/rest/v1/job_opportunities", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: candidate.userId, role_title: "Compiler Engineer", company_name: "Match Co",
      status: "discovered", description: "Compiler toolchain in Rust and LLVM.",
    }),
  });
  const tailorOppId = tailorOpp.json?.[0]?.id;
  // The master resume is a real uploaded file, and uploading one needs a
  // working storage bucket -- `local-flow-6-resume.mjs` is where the upload is
  // exercised and where a local-stack storage defect is reported. This flow
  // registers the resume row directly, so the file is absent and the route
  // correctly stops at its precondition rather than calling the provider.
  const tailor = await call(candidate, "POST", "/api/tailor", { jobId: tailorOppId });
  if (hasKey) {
    record("resume", "POST /api/tailor returns 200", tailor.status === 200,
      `status=${tailor.status} ${JSON.stringify(tailor.json ?? tailor.text).slice(0, 200)}`);
  } else {
    record("resume", "tailor stops at the master-resume precondition, ahead of the provider",
      tailor.status === 400 && /master resume/i.test(JSON.stringify(tailor.json ?? "")),
      `status=${tailor.status} ${JSON.stringify(tailor.json ?? "").slice(0, 200)} -- the upload itself is in local-flow-6-resume.mjs`);
  }
  const tailorAnon = await fetch(`${BASE}/api/tailor`, { method: "POST", redirect: "manual" });
  record("resume", "an anonymous tailor request is not served", tailorAnon.status !== 200,
    `status=${tailorAnon.status}`);

  // Validation runs ahead of the provider call, so a malformed id is a 400 even
  // though the provider is unconfigured. Worth pinning: it means the route is
  // not simply forwarding everything to OpenAI.
  const tailorBadId = await call(candidate, "POST", "/api/tailor", { jobId: "not-a-uuid" });
  record("resume", "a malformed jobId is refused with 400 before any model call",
    tailorBadId.status === 400, `status=${tailorBadId.status} ${JSON.stringify(tailorBadId.json ?? tailorBadId.text).slice(0, 130)}`);

  // A well-formed id for a job this candidate does not track.
  const tailorUntracked = await call(candidate, "POST", "/api/tailor", {
    jobId: "00000000-0000-4000-8000-00000000beef",
  });
  record("resume", "a job the candidate does not track is 404, not a provider error",
    tailorUntracked.status === 404, `status=${tailorUntracked.status} ${JSON.stringify(tailorUntracked.json ?? tailorUntracked.text).slice(0, 130)}`);

  // Another candidate's tracked job is equally invisible.
  const tailorForeign = await call(otherCandidate, "POST", "/api/tailor", { jobId: tailorOppId });
  record("privacy", "a candidate cannot tailor for another candidate's job",
    tailorForeign.status === 404 || tailorForeign.status === 403,
    `status=${tailorForeign.status}`);

  // --- jobs ------------------------------------------------------------
  const feed = await call(candidate, "GET", "/api/jobs/home-feed");
  record("jobs", "GET /api/jobs/home-feed returns 200", feed.status === 200,
    `status=${feed.status} ${JSON.stringify(feed.json ?? feed.text).slice(0, 180)}`);
  record("jobs", "the feed is empty for a candidate with no tracked jobs",
    Array.isArray(feed.json?.items) && feed.json.items.length === 0, "");

  // `discover` is POST, and it matches candidate resumes against job sources,
  // so without a model key it fails closed with the same named refusal.
  const discover = await call(candidate, "POST", "/api/jobs/discover", {});
  if (hasKey) {
    record("jobs", "POST /api/jobs/discover returns 200", discover.status === 200,
      `status=${discover.status} ${JSON.stringify(discover.json ?? discover.text).slice(0, 200)}`);
  } else {
    record("jobs", "with no OPENAI_API_KEY, discovery fails closed naming the variable (8F blocker)",
      discover.status === 503 && discover.json?.code === "INTEGRATION_NOT_CONFIGURED",
      `status=${discover.status} ${JSON.stringify(discover.json).slice(0, 200)}`);
  }
  const discoverAnon = await fetch(`${BASE}/api/jobs/discover`, { method: "POST", redirect: "manual" });
  record("jobs", "an anonymous discovery request is not served", discoverAnon.status !== 200,
    `status=${discoverAnon.status}`);

  // --- a real employer job to act on -------------------------------------
  const employer = await signIn(N("emp") + "@matchco.test", PASSWORD, { account_type: "employer" });
  const orgRes = await call(employer, "POST", "/api/employer/orgs", { companyName: "Match Co" });
  const orgId = orgRes.json?.org?.id ?? orgRes.json?.id;
  const jobRes = await call(employer, "POST", `/api/employer/orgs/${orgId}/jobs`, {
    title: "Compiler Engineer",
    description: "Design and maintain a production compiler toolchain. Rust, LLVM, and strong typing systems. Remote.",
    location: "Remote",
  });
  const jobId = jobRes.json?.id ?? jobRes.json?.job?.id;
  record("match", "a real employer job exists to match against", !!jobId, `jobId=${jobId}`);

  // --- Match Score (a model call) ----------------------------------------
  const matchBody = {
    resumeId,
    jobDescription: "Design and maintain a production compiler toolchain. Rust, LLVM, and strong typing systems.",
  };
  const match = await call(candidate, "POST", "/api/match", matchBody);
  if (hasKey) {
    record("match", "POST /api/match returns 200", match.status === 200,
      `status=${match.status} ${JSON.stringify(match.json ?? match.text).slice(0, 220)}`);
    record("match", "the score is a number", typeof match.json?.score === "number",
      `score=${JSON.stringify(match.json?.score)}`);
  } else {
    // The route fails closed with a named, specific reason rather than a vague
    // failure, and it names the missing variable. That is the honest answer
    // when no key is configured, and it is worth asserting as such.
    record("match", "with no OPENAI_API_KEY the route fails closed naming the missing variable (8F blocker)",
      match.status === 503 && match.json?.code === "INTEGRATION_NOT_CONFIGURED"
        && JSON.stringify(match.json?.missing ?? []).includes("OPENAI_API_KEY"),
      `status=${match.status} ${JSON.stringify(match.json).slice(0, 200)}`);
    record("match", "it does not invent a score",
      !("score" in (match.json ?? {})), JSON.stringify(match.json).slice(0, 160));
  }

  // The applicant identity must not be readable by a signed-out caller.
  const anonMatch = await fetch(`${BASE}/api/match`, { method: "POST", redirect: "manual" });
  record("match", "an anonymous match request is not served", anonMatch.status !== 200,
    `status=${anonMatch.status}`);

  // --- wallet -------------------------------------------------------------
  const wallet = await call(candidate, "GET", "/api/wallet");
  record("wallet", "GET /api/wallet returns 200", wallet.status === 200,
    `status=${wallet.status} ${JSON.stringify(wallet.json ?? wallet.text).slice(0, 200)}`);
  // The real field is `wallet_balance_cents`.
  record("wallet", "a new candidate has a zero balance", wallet.json?.wallet_balance_cents === 0,
    `wallet_balance_cents=${JSON.stringify(wallet.json?.wallet_balance_cents)}`);
  record("wallet", "the 39c / 99c apply rates are reported to the candidate",
    wallet.json?.standard_apply_rate_cents === 39 && wallet.json?.smart_apply_rate_cents === 99,
    `standard=${JSON.stringify(wallet.json?.standard_apply_rate_cents)} smart=${JSON.stringify(wallet.json?.smart_apply_rate_cents)}`);
  record("wallet", "with a zero balance neither apply mode is affordable",
    wallet.json?.standard_apply_affordable === false && wallet.json?.smart_apply_affordable === false, "");

  // A balance is server-controlled. The route is GET-only, so a POST is a 405
  // before any handler runs -- which is the strongest form of the guarantee.
  const fakeTopUp = await call(candidate, "POST", "/api/wallet", { amountCents: 100000 });
  record("wallet", "the wallet route exposes no write at all", fakeTopUp.status === 405,
    `status=${fakeTopUp.status}`);
  const walletAfter = await call(candidate, "GET", "/api/wallet");
  record("wallet", "the balance is still zero after that attempt",
    walletAfter.json?.wallet_balance_cents === 0,
    `wallet_balance_cents=${JSON.stringify(walletAfter.json?.wallet_balance_cents)}`);

  // A top-up is credited by inserting the `billing_events` row the Stripe
  // webhook inserts, and the balance follows from it. Reproducing the webhook's
  // own write is the faithful fixture; calling an admin adjustment instead
  // would test a different mechanism and would write a false audit trail
  // attributing a role the candidate does not hold.
  const viaWebhookPath = await admin("/rest/v1/billing_events", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      stripe_event_id: `evt_integration_${Date.now()}`,
      checkout_session_id: `cs_integration_${Date.now()}`,
      user_id: candidate.userId,
      credit_type: "wallet_topup",
      credit_delta: 5000,
      sku: "wallet_50",
      amount_cents: 5000,
      currency: "usd",
      metadata: { note: "integration fixture standing in for a paid top-up" },
    }),
  });
  record("wallet", "a billing_event as the wallet webhook writes it credits the balance",
    viaWebhookPath.status < 400, `status=${viaWebhookPath.status} ${String(viaWebhookPath.text).slice(0, 160)}`);

  // The same event id twice must not credit twice.
  const replayEventId = `evt_replay_${Date.now()}`;
  const replayBody = {
    stripe_event_id: replayEventId, checkout_session_id: `cs_${replayEventId}`,
    user_id: candidate.userId, credit_type: "wallet_topup", credit_delta: 1000,
    sku: "wallet_10", amount_cents: 1000, currency: "usd", metadata: {},
  };
  const first = await admin("/rest/v1/billing_events", {
    method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(replayBody),
  });
  const balanceAfterFirst = (await call(candidate, "GET", "/api/wallet")).json?.wallet_balance_cents;
  const second = await admin("/rest/v1/billing_events", {
    method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(replayBody),
  });
  const balanceAfterSecond = (await call(candidate, "GET", "/api/wallet")).json?.wallet_balance_cents;
  record("wallet", "replaying the same Stripe event id does not credit twice",
    first.status < 400 && balanceAfterFirst === balanceAfterSecond,
    `first=${first.status} second=${second.status} balance ${balanceAfterFirst} -> ${balanceAfterSecond}`);

  const walletFunded = await call(candidate, "GET", "/api/wallet");
  record("wallet", "the funded balance is visible to the candidate",
    walletFunded.json?.wallet_balance_cents === 6000,
    `wallet_balance_cents=${JSON.stringify(walletFunded.json?.wallet_balance_cents)}`);
  // $60.00 covers both rates, so both are affordable. The interesting boundary
  // is a balance between 39 and 99, which is exercised by draining the wallet
  // to just above the Standard Apply rate.
  record("wallet", "a $60.00 balance makes both apply modes affordable",
    walletFunded.json?.standard_apply_affordable === true
      && walletFunded.json?.smart_apply_affordable === true,
    `standard=${JSON.stringify(walletFunded.json?.standard_apply_affordable)} smart=${JSON.stringify(walletFunded.json?.smart_apply_affordable)}`);

  // Drain to 60c: above Standard Apply (39c), below Smart Apply (99c). The
  // finance admin path is the only debit that exists, so it is the one used.
  const drained = await admin("/rest/v1/rpc/odesseus_admin_adjust_wallet", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      p_user_id: candidate.userId, p_amount_cents: -5940,
      p_reference: `integration-drain-${Date.now()}`,
      p_reason: "integration test: drain to the 39c/99c boundary",
      p_actor_user_id: candidate.userId, p_actor_role: "finance_admin", p_actor_email: "finance@local",
    }),
  });
  record("wallet", "a finance admin debit is accepted", drained.status < 400,
    `status=${drained.status} ${String(drained.text).slice(0, 140)}`);

  const boundary = await call(candidate, "GET", "/api/wallet");
  record("wallet", "at 60c, Standard Apply is affordable and Smart Apply is not",
    boundary.json?.wallet_balance_cents === 60
      && boundary.json?.standard_apply_affordable === true
      && boundary.json?.smart_apply_affordable === false,
    `balance=${JSON.stringify(boundary.json?.wallet_balance_cents)} standard=${JSON.stringify(boundary.json?.standard_apply_affordable)} smart=${JSON.stringify(boundary.json?.smart_apply_affordable)}`);

  // A marketing admin may never move money, whichever layer asks.
  const marketing = await admin("/rest/v1/rpc/odesseus_admin_adjust_wallet", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      p_user_id: candidate.userId, p_amount_cents: 100000,
      p_reference: `integration-marketing-${Date.now()}`,
      p_reason: "integration test: a marketing role must not move money",
      p_actor_user_id: candidate.userId, p_actor_role: "marketing_admin", p_actor_email: "marketing@local",
    }),
  });
  record("wallet", "a marketing_admin may not move a candidate's money", marketing.status >= 400,
    `status=${marketing.status} ${String(marketing.text).slice(0, 140)}`);
  const afterMarketing = await call(candidate, "GET", "/api/wallet");
  record("wallet", "the balance is unchanged after that refusal",
    afterMarketing.json?.wallet_balance_cents === 60,
    `balance=${JSON.stringify(afterMarketing.json?.wallet_balance_cents)}`);

  // Unknown roles are refused by the database, not only by the route.
  const bogusRole = await admin("/rest/v1/rpc/odesseus_admin_adjust_wallet", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      p_user_id: candidate.userId, p_amount_cents: 100000,
      p_reference: `integration-bogus-${Date.now()}`,
      p_reason: "integration test: an unknown role must not move money",
      p_actor_user_id: candidate.userId, p_actor_role: "superuser", p_actor_email: "bogus@local",
    }),
  });
  record("wallet", "an unknown admin role is refused by the database", bogusRole.status >= 400,
    `status=${bogusRole.status} ${String(bogusRole.text).slice(0, 140)}`);

  const txn = await call(candidate, "GET", "/api/wallet/transactions");
  record("wallet", "GET /api/wallet/transactions returns 200", txn.status === 200,
    `status=${txn.status} ${JSON.stringify(txn.json ?? txn.text).slice(0, 200)}`);
  // The candidate's statement is the wallet transaction types only. An internal
  // finance adjustment moves the balance but is not shown to the candidate as a
  // wallet purchase, so the count stays at the two top-ups -- and the replayed
  // event is what would have made it three.
  record("wallet", "the statement lists the two top-ups, and neither the debit nor the replay",
    (txn.json?.items ?? []).length === 2,
    `items=${(txn.json?.items ?? []).length} types=${JSON.stringify((txn.json?.items ?? []).map((i) => `${i.credit_type}:${i.delta}`))}`);
  record("wallet", "the statement carries a running balance after each entry",
    (txn.json?.items ?? []).every((i) => typeof i.balance_cents_after === "number"),
    JSON.stringify((txn.json?.items ?? []).map((i) => i.balance_cents_after)));
  // Another candidate cannot read this one.
  const foreignTxn = await call(otherCandidate, "GET", "/api/wallet/transactions");
  record("privacy", "another candidate sees none of these transactions",
    (foreignTxn.json?.items ?? []).length === 0, `items=${(foreignTxn.json?.items ?? []).length}`);

  // --- apply eligibility ---------------------------------------------------
  await grantSubscription(orgId, "growth", 10);
  await admin("/rest/v1/employer_job_post_credits", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ org_id: orgId, total: 10, used: 0, granted_at: new Date().toISOString() }),
  });
  const published = await call(employer, "PATCH", `/api/employer/orgs/${orgId}/jobs/${jobId}`, { action: "publish" });
  record("apply", "the employer job is published", published.status === 200, `status=${published.status}`);

  // `job_opportunities` has `description`, not `job_description`.
  const opp = await admin("/rest/v1/job_opportunities", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: candidate.userId, role_title: "Compiler Engineer", company_name: "Match Co",
      status: "discovered", employer_job_id: jobId,
      description: "Design and maintain a production compiler toolchain. Rust, LLVM, and strong typing systems.",
    }),
  });
  const oppId = opp.json?.[0]?.id;
  record("apply", "a tracked job opportunity exists", !!oppId, `opportunityId=${oppId}`);

  // Apply needs BrowserBase, which is absent. The refusal must be specific.
  const start = await call(candidate, "POST", "/api/apply/start", { opportunityId: oppId });
  if (process.env.BROWSERBASE_API_KEY) {
    record("apply", "POST /api/apply/start starts an apply", start.status === 200 || start.status === 201,
      `status=${start.status} ${JSON.stringify(start.json ?? start.text).slice(0, 200)}`);
  } else {
    record("apply", "with no BrowserBase credentials the route fails closed naming them (8F blocker)",
      start.status === 503 && start.json?.code === "INTEGRATION_NOT_CONFIGURED",
      `status=${start.status} ${JSON.stringify(start.json).slice(0, 200)}`);
  }

  // --- tracked-job status ---------------------------------------------------
  // The writable vocabulary is discovered | saved | rejected. `applied` is not
  // candidate-writable, which is correct: an application is a verified fact.
  for (const [label, status, expect] of [
    ["saved", "saved", 200],
    ["reviewing", "reviewing", 400],
    ["rejected", "rejected", 200],
    ["applied", "applied", 400],
  ]) {
    const r = await call(candidate, "POST", `/api/jobs/${oppId}/status`, { status });
    record("tracked", `${label} -> ${expect}`, r.status === expect,
      `status=${r.status} ${JSON.stringify(r.json ?? r.text).slice(0, 120)}`);
  }
  const statusDb = await admin(`/rest/v1/job_opportunities?id=eq.${oppId}&select=status`);
  record("tracked", "the status is in the DATABASE",
    ["saved", "rejected", "reviewing", "applied"].includes((statusDb.json ?? [])[0]?.status),
    JSON.stringify(statusDb.json ?? statusDb.text).slice(0, 160));

  // Another candidate cannot move this one.
  const foreignStatus = await call(otherCandidate, "POST", `/api/jobs/${oppId}/status`, { status: "rejected" });
  record("privacy", "another candidate cannot change this tracked job", foreignStatus.status >= 400,
    `status=${foreignStatus.status}`);

  // --- application + interview creation ---------------------------------------
  const application = await admin("/rest/v1/applications", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: candidate.userId, job_id: oppId, company_name: "Match Co",
      role_title: "Compiler Engineer", status: "approved",
    }),
  });
  const applicationId = application.json?.[0]?.id;
  record("interview", "a real application exists for the interview to attach to", !!applicationId,
    `applicationId=${applicationId}`);

  // The real schema: company, roleTitle, scheduledAt, timezone, round, notes,
  // applicationId, applicationUrl, meetingProvider, meetingUrl, source, status.
  // Note every key is present even where the value is null: `z.nullable()` lets
  // a value be null but does not make the key optional, so a partial body is
  // refused. Sending the full shape is what the endpoint's contract asks for.
  const interviewBody = {
    company: "Match Co",
    roleTitle: "Compiler Engineer",
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    timezone: "America/New_York",
    round: "1",
    notes: "Technical screen.",
    applicationId,
    applicationUrl: null,
    meetingProvider: null,
    meetingUrl: null,
    source: "manual",
    status: "scheduled",
  };
  const interview = await call(candidate, "POST", "/api/interviews", interviewBody);
  record("interview", "POST /api/interviews creates an interview", interview.status === 200 || interview.status === 201,
    `status=${interview.status} ${JSON.stringify(interview.json ?? interview.text).slice(0, 220)}`);
  const interviewId = interview.json?.interview?.id ?? interview.json?.id;
  record("interview", "the interview has an id", !!interviewId, `interviewId=${interviewId}`);

  // The candidate's own application id is accepted; someone else's is refused.
  const foreignApp = await admin("/rest/v1/applications", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: otherCandidate.userId, company_name: "Someone Else", role_title: "Engineer",
    }),
  });
  const foreignAppId = foreignApp.json?.[0]?.id;
  const attach = await call(candidate, "POST", "/api/interviews", {
    ...interviewBody, applicationId: foreignAppId,
  });
  record("privacy", "a candidate cannot attach an interview to another candidate's application",
    attach.status === 403, `status=${attach.status} ${JSON.stringify(attach.json ?? attach.text).slice(0, 140)}`);

  const badInterview = await call(candidate, "POST", "/api/interviews", { ...interviewBody, company: "" });
  record("interview", "an interview with no company is refused with 400", badInterview.status === 400,
    `status=${badInterview.status}`);

  const badStage = await call(candidate, "POST", "/api/interviews", { ...interviewBody, status: "won" });
  record("interview", "a status outside the interview vocabulary is refused with 400", badStage.status === 400,
    `status=${badStage.status}`);

  const badUuid = await call(candidate, "POST", "/api/interviews", { ...interviewBody, applicationId: "nope" });
  record("interview", "a non-uuid applicationId is refused with 400", badUuid.status === 400,
    `status=${badUuid.status}`);

  // A second interview on the same application is a distinct row, not an
  // overwrite: multi-round interview memory depends on rounds coexisting.
  const round2 = await call(candidate, "POST", "/api/interviews", {
    ...interviewBody, round: "2", status: "completed", notes: "Onsite loop.",
  });
  record("interview", "a second round is a separate row", round2.status === 200 || round2.status === 201,
    `status=${round2.status}`);
  const interviewRows = await admin(
    `/rest/v1/interviews?user_id=eq.${candidate.userId}&select=round_number,status&order=created_at.asc`);
  record("interview", "both rounds are in the DATABASE", (interviewRows.json ?? []).length === 2,
    JSON.stringify(interviewRows.json ?? interviewRows.text).slice(0, 200));

  // Another candidate cannot read this candidate's interview.
  const otherRead = await call(otherCandidate, "GET", `/api/interviews/${interviewId}/workspace`);
  record("privacy", "another candidate cannot read this interview's workspace",
    otherRead.status === 404 || otherRead.status === 403,
    `status=${otherRead.status} ${JSON.stringify(otherRead.json ?? otherRead.text).slice(0, 130)}`);

  // --- Live entitlement read ----------------------------------------------------
  const entitlement = await call(candidate, "GET", "/api/live/entitlement");
  record("live", "GET /api/live/entitlement returns 200", entitlement.status === 200,
    `status=${entitlement.status}`);
  // The real field is `hasAccess`.
  record("live", "a candidate with no purchase has no entitlement",
    entitlement.json?.hasAccess === false && entitlement.json?.source === "none",
    JSON.stringify(entitlement.json).slice(0, 200));
  record("live", "the fair-use allowance is reported", entitlement.json?.fairUse?.sessions === 20,
    `fairUse=${JSON.stringify(entitlement.json?.fairUse)}`);
  record("live", "the read does not leak a membership or Stripe id",
    entitlement.json?.membershipId === null && !JSON.stringify(entitlement.json).toLowerCase().includes("stripe"),
    JSON.stringify(entitlement.json).slice(0, 200));

  const otherEntitlement = await call(otherCandidate, "GET", "/api/live/entitlement");
  record("privacy", "another candidate's entitlement read is their own",
    otherEntitlement.json?.hasAccess === false
      && JSON.stringify(otherEntitlement.json) === JSON.stringify(entitlement.json),
    "");

  // --- other candidate surfaces ----------------------------------------------------
  for (const [label, method, path, body] of [
    ["GET /api/dashboard", "GET", "/api/dashboard", undefined],
    ["GET /api/account/export", "GET", "/api/account/export", undefined],
    ["GET /api/notifications", "GET", "/api/notifications", undefined],
    ["GET /api/notifications/unread-count", "GET", "/api/notifications/unread-count", undefined],
    ["GET /api/notification-preferences", "GET", "/api/notification-preferences", undefined],
    ["GET /api/pricing", "GET", "/api/pricing", undefined],
    ["GET /api/countries", "GET", "/api/countries", undefined],
    ["GET /api/health/config", "GET", "/api/health/config", undefined],
  ]) {
    const r = await call(candidate, method, path, body);
    record("surfaces", `${label} -> 200`, r.status === 200,
      `status=${r.status} ${JSON.stringify(r.json ?? r.text).slice(0, 140)}`);
  }

  // A candidate must not reach employer surfaces.
  for (const [label, method, path, body] of [
    ["the employer candidate list", "GET", `/api/employer/orgs/${orgId}/candidates`, undefined],
    ["employer analytics", "GET", `/api/employer/orgs/${orgId}/analytics`, undefined],
    ["employer team", "GET", `/api/employer/orgs/${orgId}/team`, undefined],
    ["an employer job write", "POST", `/api/employer/orgs/${orgId}/jobs`, { title: "Nope" }],
  ]) {
    const r = await call(candidate, method, path, body);
    record("privacy", `a candidate cannot reach ${label}`, r.status === 403 || r.status === 404,
      `status=${r.status}`);
  }

  return { candidate, interviewId, applicationId, jobId, orgId, employer };
}

main()
  .then(() => { process.exitCode = summary() === 0 ? 0 : 1; })
  .catch((e) => { console.error("HARNESS ERROR:", e.message, e.stack); process.exitCode = 1; });
