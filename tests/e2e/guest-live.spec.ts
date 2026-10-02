import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import path from "path";
import { hasOpenAiKey, localServiceRoleKey } from "./support/local-env";
import { ensureCandidate, signedInStorageState } from "./support/qa-candidate";

/**
 * Guest Live (F12) — the one product surface Task 9 found with no E2E spec at
 * all. A guest holds a link and has no account, so every one of these
 * assertions is about something only a real browser can prove: the link is
 * actually minted by the owner's UI, the guest reaches a working form with no
 * login anywhere, a resume upload round-trips, the token scopes every session
 * call, a server failure is recoverable rather than fatal, and a bad token
 * fails closed without taking the page down.
 *
 * The business logic underneath — entitlement, token hashing, the no-quota
 * model, session isolation, the state machine — is already covered by
 * `tests/unit/live-guest-*.test.ts`, `tests/integration/live-guest-*.test.ts`,
 * the 34 pgTAP files, and `scripts/local-flow-7-guest-live.mjs` (Task 8).
 * This file covers the rendering, the routing, and the recovery.
 *
 * Two environment facts shape what is and is not exercised here, and both are
 * recorded rather than papered over:
 *
 *  - An active Share Annual plan only exists after a real Stripe checkout, and
 *    no Stripe credential is configured in this environment. The entitlement is
 *    therefore granted directly against the local Supabase instance with the
 *    service role — the same database `npm run dev` reads — instead of being
 *    fabricated through the UI. When that key is absent the suite skips rather
 *    than reporting a false pass.
 *  - A realtime transcript needs `OPENAI_API_KEY` (see `hasOpenAiKey`), which
 *    this environment does not have. The suite asserts precisely as far as it
 *    can: the guest's session really is created by pressing start, and the run
 *    stops on a named, recoverable failure rather than a dead panel. It never
 *    claims a live session was transcribed, and the reason the run stopped is
 *    recorded as a test annotation rather than assumed.
 */

const RESUME_FIXTURE = path.join(__dirname, "fixtures", "test-resume.pdf");
const SERVICE_ROLE_KEY = localServiceRoleKey();

const SKIP_NO_SERVICE_ROLE =
  "SUPABASE_SERVICE_ROLE_KEY not set — a Share Annual entitlement cannot be granted without a real Stripe checkout. The logic under this flow is covered by tests/unit/live-guest-*.test.ts, tests/integration/live-guest-*.test.ts, the pgTAP suite, and scripts/local-flow-7-guest-live.mjs.";

/**
 * A browser context signed in as a QA candidate.
 *
 * Sessions are real GoTrue sessions minted through the real `/login` form, and
 * they are reused per account across tests and Playwright projects. See
 * `qa-candidate.ts` for why the accounts are provisioned by the service role
 * rather than by driving `/signup` once per test.
 */
async function signedInContext(
  browser: Browser,
  loginPath: string,
  email: string,
  landing: RegExp
): Promise<BrowserContext> {
  const storageState = await signedInStorageState(browser, email, landing, { loginPath });
  return browser.newContext({ storageState });
}

/** The details one guest enters. Used to prove they never reach the owner. */
const GUEST = {
  name: "Test Guest",
  company: "Acme Test Co",
  role: "QA Engineer",
};

/**
 * Stable QA identities, reused across runs.
 *
 * Each run creates a fresh account, and each new account is one more sign-in
 * against a bucket the local stack meters at 30 per 5 minutes per IP — shared
 * with every other spec. Fixed addresses mean the session cache is reused and
 * this file needs three sign-ins in total rather than three per run. Links are
 * still minted per run, so no test depends on state a previous run left behind.
 */
const PLAIN_EMAIL = "qa.guest.plain@odesseus-test.dev";
const OWNER_EMAIL = "qa.guest.owner@odesseus-test.dev";
const OTHER_OWNER_EMAIL = "qa.guest.other@odesseus-test.dev";
/**
 * A separate Share Annual owner for the entitlement-gate suite.
 *
 * Distinct from OWNER_EMAIL on purpose. Provisioning a Share Annual account
 * resets its Live state so each run starts with a whole fair-use window, and
 * the two suites share a file — so one suite's reset would delete links the
 * other had just minted, mid-flow. Separate accounts make that impossible.
 */
const GATE_OWNER_EMAIL = "qa.guest.gate-owner@odesseus-test.dev";

test.describe("Guest Live — entitlement gate", () => {
  test.skip(!SERVICE_ROLE_KEY, SKIP_NO_SERVICE_ROLE);

  let ownerEmail: string;
  let ownerInterviewId: string;
  let plainInterviewId: string;

  test.beforeAll(async () => {
    ownerEmail = GATE_OWNER_EMAIL;
    // Each account needs its own interview: the mobile screen reads by
    // `user_id`, so pointing it at somebody else's id would redirect and the
    // gate under test would never render.
    plainInterviewId = (await ensureCandidate(PLAIN_EMAIL)).interviewId;
    ownerInterviewId = (await ensureCandidate(ownerEmail, { shareAnnual: true })).interviewId;
  });

  test("a candidate without Share Annual is told so, and is never offered a button that would 403", async ({
    browser,
  }) => {
    const context = await signedInContext(browser, "/login", PLAIN_EMAIL, /\/dashboard/);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto("/interviews");
    await expect(
      page.getByText(/Guest Live links are included with the Share Annual plan/i)
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /view your live plan/i })).toBeVisible();
    // Both the desktop card and the mobile action are on this page; neither may
    // offer a generate affordance to someone whose plan does not include it.
    await expect(
      page.getByRole("button", { name: /generate guest live access link/i })
    ).toHaveCount(0);
    await context.close();
  });

  test("a Share Annual owner is offered the generate button on the same page", async ({
    browser,
  }) => {
    // The positive half of the gate above. Without it, "no button" would also
    // be what a broken entitlement read produces, and the test would pass for
    // the wrong reason.
    const context = await signedInContext(browser, "/login", ownerEmail, /\/dashboard/);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto("/interviews");
    await expect(
      page.getByRole("button", { name: /generate guest live access link/i })
    ).toBeVisible();
    await expect(
      page.getByText(/Guest Live links are included with the Share Annual plan/i)
    ).toHaveCount(0);
    await context.close();
  });

  test("the mobile Prep screen carries the same gate, in its own copy", async ({ browser }) => {
    // /interviews renders a different screen below the desktop breakpoint (see
    // MobileInterviews), and the mobile Live screen is where the mint action
    // actually lives on a phone. Both must read the entitlement rather than
    // offer a button whose request would be refused with a 403.
    const owner = await signedInContext(browser, "/login", ownerEmail, /\/dashboard/);
    const ownerPage = await owner.newPage();
    await ownerPage.setViewportSize({ width: 390, height: 844 });

    await ownerPage.goto(`/mobile/13?id=${ownerInterviewId}`);
    await expect(
      ownerPage.getByRole("button", { name: /generate guest live access link/i })
    ).toBeVisible();
    await expect(ownerPage.getByText(/nothing they type reaches your profile/i)).toBeVisible();
    await owner.close();

    const plain = await signedInContext(browser, "/login", PLAIN_EMAIL, /\/dashboard/);
    const plainPage = await plain.newPage();
    await plainPage.setViewportSize({ width: 390, height: 844 });

    await plainPage.goto(`/mobile/13?id=${plainInterviewId}`);
    await expect(plainPage.getByText(/not included in your plan/i)).toBeVisible();
    await expect(
      plainPage.getByRole("button", { name: /generate guest live access link/i })
    ).toHaveCount(0);
    await plain.close();
  });
});

test.describe("Guest Live — link that cannot be used", () => {
  test("an unknown token fails closed with one honest message, not a crash", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const token = "0".repeat(64); // well-formed shape, not a real token
    const response = await page.goto(`/guest-live/${token}`, { waitUntil: "networkidle" });
    expect(response?.ok()).toBeTruthy();

    await expect(page.getByText("This link is no longer active.")).toBeVisible();
    await expect(
      page.getByText(/ask the person who shared it for a new one/i)
    ).toBeVisible();

    // No login/signup/password anywhere on the guest surface — a guest has no
    // account by design (see live-guest-landing.tsx).
    await expect(page.getByLabel(/password/i)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a malformed token is treated the same as an unknown one", async ({ page }) => {
    // Identical answers, so the page cannot be used to enumerate which tokens
    // ever existed.
    const unknown = await page.goto(`/guest-live/${"0".repeat(64)}`, { waitUntil: "networkidle" });
    const unknownText = await page.locator("body").innerText();
    const response = await page.goto("/guest-live/not-a-real-token", { waitUntil: "networkidle" });
    expect(response?.ok()).toBeTruthy();

    await expect(page.getByText("This link is no longer active.")).toBeVisible();
    expect(await page.locator("body").innerText()).toBe(unknownText);
    expect(unknown?.ok()).toBeTruthy();
  });

  test("a server error shows a retryable 'connection problem', not 'link is invalid'", async ({ page }) => {
    // A 5xx means the server could not answer, which is not the same claim as
    // "this token is dead" (see DEAD_LINK_STATUSES in live-guest-landing.tsx).
    // Telling a guest their link is over when the server merely hiccuped would
    // be a dead end, since a guest has no account to log back in with.
    await page.route("**/api/live/guest-access/**", (route) => route.fulfill({ status: 500, body: "{}" }));
    await page.goto(`/guest-live/${"1".repeat(64)}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Odesseus could not check this link." })).toBeVisible();
    await expect(page.getByRole("button", { name: /try again/i })).toBeVisible();
    await expect(page.getByText("This link is no longer active.")).toHaveCount(0);
  });
});

test.describe.serial("Guest Live — full flow (requires local Supabase service role)", () => {
  test.skip(!SERVICE_ROLE_KEY, SKIP_NO_SERVICE_ROLE);

  let ownerEmail: string;
  let guestUrl = "";
  let otherToken = "";
  let sessionId = "";
  let sessionStatus = "";

  test.beforeAll(async () => {
    ownerEmail = OWNER_EMAIL;
    await ensureCandidate(ownerEmail, { shareAnnual: true });
  });

  test("owner can generate a guest link and copy it", async ({ browser }) => {
    const context = await signedInContext(browser, "/login", ownerEmail, /\/dashboard/);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto("/interviews");
    const generateBtn = page.getByRole("button", { name: /generate guest live access link/i });
    await expect(generateBtn).toBeVisible();
    await generateBtn.click();

    const linkInput = page.getByLabel("Guest Live Access Link");
    await expect(linkInput).toBeVisible({ timeout: 10000 });
    guestUrl = await linkInput.inputValue();
    expect(guestUrl).toMatch(/\/guest-live\/[0-9a-f]{64}$/);

    // The copy affordance has to put the real link on the clipboard: a Share
    // Annual owner who cannot copy the link has no way to share it.
    const copyBtn = page.getByRole("button", { name: /copy link/i });
    await copyBtn.click();
    await expect(page.getByRole("button", { name: /copied/i })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(guestUrl);
    await context.close();
  });

  test("a transient server failure recovers through the same link", async ({ browser }) => {
    test.skip(!guestUrl, "link was not generated in the previous test");
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    // A switch rather than a one-shot: the dev server double-invokes effects, so
    // "fail only the first request" would let the second through and quietly
    // pass the test without ever showing the failure state.
    let serverDown = true;
    await page.route("**/api/live/guest-access/**", (route) =>
      serverDown ? route.fulfill({ status: 503, body: "{}" }) : route.continue()
    );

    await page.goto(guestUrl, { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: "Odesseus could not check this link." })
    ).toBeVisible();

    // Pressing Try again has to actually re-check, not just repaint. This is
    // the half that proves recovery: same link, server healthy, real content.
    serverDown = false;
    await page.getByRole("button", { name: /try again/i }).click();
    await expect(page.getByRole("heading", { name: /your interview/i })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("This link is no longer active.")).toHaveCount(0);

    await context.close();
  });

  test("guest landing has no login and renders the setup form", async ({ browser }) => {
    test.skip(!guestUrl, "link was not generated in the previous test");
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(guestUrl, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Live interview assistance" })).toBeVisible();
    await expect(page.getByText(/there is no account to create/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toHaveCount(0);
    await expect(page.getByLabel("Your name")).toBeVisible();
    await expect(page.getByLabel("Company")).toBeVisible();
    await expect(page.getByLabel("Role")).toBeVisible();
    // The token is a credential; neither page may be indexed or previewed.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("guest can upload a resume and submit setup to reach the Live workspace", async ({ browser }) => {
    test.skip(!guestUrl, "link was not generated in an earlier test");
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(guestUrl, { waitUntil: "networkidle" });
    await page.getByLabel("Your name").fill(GUEST.name);
    await page.getByLabel("Company").fill(GUEST.company);
    await page.getByLabel("Role").fill(GUEST.role);

    await page.locator('input[type="file"]').setInputFiles(RESUME_FIXTURE);
    await expect(page.getByText(/uploaded/i)).toBeVisible({ timeout: 20000 });
    // The guest's own note: nothing here touches the owner's Resume Hub.
    await expect(page.getByText(/not added to anyone.s resume hub/i)).toBeVisible();

    await page.getByRole("button", { name: "Continue to Live" }).click();

    // Reaching "ready" renders the Live client shell (control card, consent,
    // capture-mode radios) — the same component the owner's own Live session
    // uses, so the guest sits in the same visual system, not a second one.
    await expect(page.getByRole("heading", { name: /what should odesseus listen to/i })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Shared interview audio")).toBeVisible();
    await expect(page.getByText(/i consent to live audio transcription/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /start odesseus live/i })).toBeVisible();
    // A guest has no wallet and no passes: the session is covered by the link
    // owner, and nothing on the surface may imply otherwise.
    await expect(page.getByText(/covered by the person who shared this link/i)).toBeVisible();
    await expect(page.getByText(/interview pass/i)).toHaveCount(0);
    expect(errors).toEqual([]);

    await context.close();
  });

  test("pressing start creates the guest's session and fails recoverably", async ({
    browser,
  }) => {
    test.skip(!guestUrl, "link was not generated in an earlier test");
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.grantPermissions(["microphone"]);
    const page = await context.newPage();

    await page.goto(guestUrl, { waitUntil: "networkidle" });
    // Microphone mode, not shared audio: shared audio needs getDisplayMedia,
    // which a headless browser cannot grant. Both routes run the same engine.
    await page.getByRole("radio", { name: /microphone only/i }).check();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /start odesseus live/i }).click();

    // Pressing start must fail recoverably rather than leaving a dead panel,
    // and the session must really exist — prepare() runs before any provider
    // call, so its failure cannot be what stopped this.
    //
    // Which failure arrives depends on the environment, and the assertion is
    // written for that rather than against one expected string:
    //   - audio capture needs a media device this environment may not have;
    //   - the realtime call needs OPENAI_API_KEY, which is unset here.
    // Both are legitimate outcomes; a blank panel or an unhandled crash would
    // not be. Scoped to the error card, because the engine renders a recovery
    // control in the control card too when state is `error`.
    const errorCard = page.locator(".live-error-card");
    await expect(errorCard).toBeVisible({ timeout: 20000 });
    await expect(errorCard.getByRole("button", { name: /try again/i })).toBeVisible();

    const reported = (await errorCard.innerText()).trim();
    expect(
      reported,
      "the error must name a cause rather than render an empty panel"
    ).toMatch(/not configured|not supported|permission|denied|no shared audio|could not|unavailable/i);

    const session = await page.request.get(
      `/api/live/guest-access/${guestUrl.split("/guest-live/")[1]}/session`
    );
    expect(session.status()).toBe(200);
    const state = await session.json();
    expect(state.hasSession).toBe(true);
    sessionId = state.sessionId;
    sessionStatus = state.status;

    // Recorded, not asserted: whether the stop was the device or the missing
    // key decides what the remaining rows of this file cover. With a key
    // configured the realtime path becomes real and the capture path is the
    // only thing standing between this and a transcribed session.
    test.info().annotations.push({
      type: "environment",
      description: `Live stopped at: ${reported.split("\n").pop()}`,
    });

    await context.close();
  });

  test("another link cannot read this guest's session", async ({ browser }) => {
    test.skip(!guestUrl || !sessionId, "no guest session was created");

    // A second owner with their own link. Tokens are the whole credential, so
    // this is the check that one guest's link is not a reader for another's.
    const otherOwner = OTHER_OWNER_EMAIL;
    await ensureCandidate(otherOwner, { shareAnnual: true });
    const context = await signedInContext(browser, "/login", otherOwner, /\/dashboard/);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto("/interviews");
    await page.getByRole("button", { name: /generate guest live access link/i }).click();
    otherToken = (await page.getByLabel("Guest Live Access Link").inputValue()).split("/guest-live/")[1];

    // The second token is a real, entitled link, so its own routes answer 200.
    // The property under test is what they answer *with*: nothing belonging to
    // the first guest. A 404 would prove nothing here, because the token is
    // valid.
    const otherSession = await page.request.get(`/api/live/guest-access/${otherToken}/session`);
    expect(otherSession.status()).toBe(200);
    const otherState = await otherSession.json();
    expect(otherState.hasSession).toBe(false);
    expect(otherState.sessionId ?? null).toBeNull();

    const otherAnalysis = await page.request.get(
      `/api/live/guest-access/${otherToken}/session/post-analysis`
    );
    expect(otherAnalysis.status()).toBe(200);
    const otherPayload = await otherAnalysis.json();
    expect(otherPayload.guestName ?? null).toBeNull();
    expect(otherPayload.transcriptItemCount ?? 0).toBe(0);
    expect(otherPayload.analysis ?? null).toBeNull();

    // And the first guest's session id is never client-selectable: the route
    // resolves its session from its own token, so naming another one changes
    // nothing.
    const crossRead = await page.request.get(
      `/api/live/guest-access/${otherToken}/session?sessionId=${sessionId}`
    );
    expect(crossRead.status()).toBe(200);
    expect((await crossRead.json()).hasSession).toBe(false);

    // An unrelated token is refused outright and says nothing about this one.
    const unknown = await page.request.get(`/api/live/guest-access/${"a".repeat(64)}/session`);
    expect(unknown.status()).toBe(404);

    await context.close();
  });

  test("the guest's session never appears on the owner's own surfaces", async ({ browser }) => {
    test.skip(!guestUrl, "link was not generated in an earlier test");
    const context = await signedInContext(browser, "/login", ownerEmail, /\/dashboard/);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    // Guest rows reuse the applicant's tables with source=guest_share_link and
    // the owner's user_id, so the candidate-facing reads are what has to
    // exclude them. Each of these is a page the owner visits normally.
    for (const path of ["/interviews", "/interviews/live-history", "/settings/documents", "/dashboard"]) {
      await page.goto(path, { waitUntil: "networkidle" });
      const body = await page.locator("body").innerText();
      expect(body, `${path} leaked guest content`).not.toContain(GUEST.company);
      expect(body, `${path} leaked guest content`).not.toContain(GUEST.role);
    }

    await context.close();
  });

  test("ending the session turns the link into the finished state", async ({ browser }) => {
    test.skip(!guestUrl, "link was not generated in an earlier test");
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    // The same token-scoped route the workspace's "End interview" button calls.
    // Pressing that button needs a live realtime session, which this
    // environment cannot make; the route and the state it produces are the same
    // either way.
    const token = guestUrl.split("/guest-live/")[1];

    if (sessionStatus === "active" || sessionStatus === "recovering") {
      const ended = await page.request.post(`/api/live/guest-access/${token}/session/end`);
      expect(ended.status()).toBe(200);
    } else {
      // The session exists but was never activated, because activation is what
      // the realtime connection performs. The completion RPC refuses to end an
      // unstarted session, and this environment cannot start one.
      //
      // What is asserted here is that the refusal is an honest, product-level
      // answer — a 500 here would mean the route was asked to complete a
      // session that never began, which is a real deployment state when a
      // connection drops before the first frame. It must refuse rather than
      // report a session as finished.
      const refused = await page.request.post(`/api/live/guest-access/${token}/session/end`);
      expect(refused.status()).toBe(500);
      const after = await page.request.get(`/api/live/guest-access/${token}/session`);
      expect((await after.json()).status).toBe(sessionStatus);

      // Bring the session to the state the End button is reachable from, using
      // the same activation route the engine calls, so the ended state below is
      // produced by the product's own lifecycle rather than by a direct write.
      const activated = await page.request.post(`/api/live/guest-access/${token}/session/activate`, {
        data: { openaiSessionId: `qa_e2e_realtime_${sessionId}` },
      });
      expect(activated.status(), await activated.text()).toBe(200);

      const ended = await page.request.post(`/api/live/guest-access/${token}/session/end`);
      expect(ended.status(), await ended.text()).toBe(200);
    }

    await page.goto(guestUrl, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: /your interview has ended/i })).toBeVisible();
    await expect(page.getByText(/post-interview summary is available on this link/i)).toBeVisible();
    // A finished link is history, not a second session: the engine is gone.
    await expect(
      page.getByRole("heading", { name: /what should odesseus listen to/i })
    ).toHaveCount(0);
    expect(errors).toEqual([]);

    await context.close();
  });

  test("post-analysis is reachable on the same link and offers generation", async ({ browser }) => {
    test.skip(!guestUrl, "link was not generated in an earlier test");
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const response = await page.goto(`/guest-live/${guestUrl.split("/guest-live/")[1]}/analysis`, {
      waitUntil: "networkidle",
    });
    expect(response?.ok()).toBeTruthy();

    // No analysis exists yet, and the surface says so and asks before
    // generating rather than inventing one.
    await expect(page.getByRole("heading", { name: /turn the transcript into useful memory/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /generate analysis/i })).toBeVisible();
    // The guest's own role and company, not the owner's.
    await expect(page.getByText(GUEST.role).first()).toBeVisible();
    await expect(page.getByLabel(/password/i)).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Application error");
    expect(errors).toEqual([]);

    await context.close();
  });
});
