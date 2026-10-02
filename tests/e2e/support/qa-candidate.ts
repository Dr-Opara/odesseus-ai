import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { localServiceRoleKey, localSupabaseUrl } from "./local-env";
import { sessionFor } from "./session-cache";

/**
 * The `interviews.source` value marking a guest-share row. Spelled here rather
 * than imported because the module that owns it (`@/lib/interviews/guest-share`)
 * pulls in the server Supabase client, which has no place in a browser test.
 * This file never compares it to anything the module computes — it selects rows
 * by a stored column value.
 */
const GUEST_SHARE_SOURCE = "guest_share_link";

/**
 * Provisioning for browser tests that need a real signed-in candidate.
 *
 * Why this exists rather than a `/signup` helper: the local Supabase stack
 * meters sign-ins and sign-ups together, 30 requests per 5 minutes per IP
 * (`sign_in_sign_ups` in supabase/config.toml), and that bucket is shared by
 * every spec in the suite. Driving `/signup` once per test per Playwright
 * project exhausts it part-way through a full run and everything after it fails
 * with "Too many attempts" — a harness artifact that is indistinguishable from
 * a product regression.
 *
 * Nothing is faked. Accounts are real, created through the Supabase admin API
 * against the same database the dev server reads; sessions are real, minted by
 * GoTrue through the real `/login` form; every page still sends a genuine
 * session cookie on every request. Only the repeated *sign-up* is skipped.
 *
 * Accounts use fixed addresses so the session cache survives across runs, and
 * every write is idempotent so a second run neither duplicates rows nor needs a
 * clean database.
 */
export const QA_PASSWORD = "TestPassword123!";

export function serviceClient(): SupabaseClient | null {
  const key = localServiceRoleKey();
  if (!key) return null;
  return createClient(localSupabaseUrl(), key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type Candidate = { userId: string; interviewId: string };

/**
 * A candidate account with a real interview behind it, created if absent.
 *
 * `shareAnnual` grants the Live Share entitlement that no UI path can reach
 * without a Stripe checkout, and resets the account's Live state so the run
 * starts from a whole fair-use window. That reset is not cosmetic: Share Annual
 * carries a real per-window ceiling (`fair_use_sessions`, copied from the
 * catalog at grant time), and the entitlement refuses activation once the
 * window is spent. Accounts are reused across runs, so without a reset the
 * suite eventually exhausts its own fixture and fails on a 402 that is the
 * product working correctly.
 *
 * `interviews.application_id` is NOT NULL, so the application row is created
 * alongside it — both belong to this candidate, which is what every screen under
 * test reads.
 */
export async function ensureCandidate(
  email: string,
  { shareAnnual = false, resetLive = shareAnnual }: { shareAnnual?: boolean; resetLive?: boolean } = {}
): Promise<Candidate> {
  const admin = serviceClient();
  if (!admin) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set, so QA accounts cannot be provisioned. Run against the pinned local Supabase stack (npm run db:start), or export the key."
    );
  }

  const userId = await ensureUser(admin, email);

  // Reset defaults to `shareAnnual` because that is the only case where a
  // stale Live state changes the answer, and it must happen in `beforeAll` —
  // while a test that is mid-flow owns the same account's sessions and links.
  // A spec that provisions the same account from two suites must pass
  // `resetLive: false` in whichever runs second, or use a separate account.
  if (shareAnnual && resetLive) {
    await resetLiveState(admin, userId);
    const { data: existing } = await admin
      .from("live_memberships")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!existing) {
      const { error } = await admin.from("live_memberships").insert({
        user_id: userId,
        plan_type: "share_annual",
        status: "active",
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
        stripe_subscription_id: `qa_e2e_${email}`,
      });
      if (error) throw new Error(`could not grant membership: ${error.message}`);
    }
  }

  return { userId, interviewId: await ensureInterview(admin, userId) };
}

/**
 * Clears the Live rows a previous run left behind for this account.
 *
 * Ordered to respect the foreign keys: transcript and guidance rows cascade
 * from a session, and `guest_access_records` holds a nullable pointer to one
 * (`on delete set null`), so the links go first and the sessions after. Only
 * guest-share rows are removed — the candidate's own interviews and their
 * sessions are real records other assertions read.
 */
async function resetLiveState(admin: SupabaseClient, userId: string): Promise<void> {
  const { data: guestInterviews } = await admin
    .from("interviews")
    .select("id")
    .eq("user_id", userId)
    .eq("source", GUEST_SHARE_SOURCE);

  const guestIds = (guestInterviews ?? []).map((row) => row.id);
  if (guestIds.length > 0) {
    // Sessions created for a guest row belong to that row, matched through the
    // guest record's own pointer rather than by interview, because the session
    // is owned by the account that owns the link.
    const { data: sessions } = await admin
      .from("live_interview_sessions")
      .select("id")
      .in("interview_id", guestIds);
    const sessionIds = (sessions ?? []).map((row) => row.id);
    if (sessionIds.length > 0) {
      await admin.from("guest_access_records").delete().in("live_session_id", sessionIds);
      await admin.from("live_interview_sessions").delete().in("id", sessionIds);
    }
    await admin.from("guest_access_records").delete().in("interview_id", guestIds);
    await admin.from("interviews").delete().in("id", guestIds);
  }

  // Any leftover guest record for this account that never reached a session.
  await admin.from("guest_access_records").delete().eq("owner_user_id", userId);
}

async function ensureUser(admin: SupabaseClient, email: string): Promise<string> {
  // Look before creating. Creating a user that already exists is reported by
  // GoTrue in more than one way depending on which constraint it trips first,
  // and one of those ways ("Database error creating new user") carries nothing
  // actionable — so the lookup is the reliable path for a reused account.
  const existing = await findUser(admin, email);
  if (existing) return existing;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: QA_PASSWORD,
    email_confirm: true,
    user_metadata: { account_type: "candidate", full_name: "QA Candidate" },
  });
  if (data?.user) return data.user.id;

  // The account may have been created concurrently by another worker between
  // the lookup and here.
  const raced = await findUser(admin, email);
  if (raced) return raced;

  throw new Error(`could not create QA account ${email}: ${error?.message}`);
}

/** The id of an existing auth user, or null. */
async function findUser(admin: SupabaseClient, email: string): Promise<string | null> {
  // GoTrue's admin API has no get-by-email, so this pages the local instance.
  // It holds a handful of QA accounts, so one page is enough; the loop only
  // guards against a developer who has signed up a lot on this stack.
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw new Error(`could not list users: ${error.message}`);
    const found = data.users.find((user) => user.email === email);
    if (found) return found.id;
    if (data.users.length < 1000) return null;
  }
  return null;
}

async function ensureInterview(admin: SupabaseClient, userId: string): Promise<string> {
  const { data: existing } = await admin
    .from("interviews")
    .select("id")
    .eq("user_id", userId)
    .is("source", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: application, error: applicationError } = await admin
    .from("applications")
    .insert({
      user_id: userId,
      company_name: "QA Fixture Co",
      role_title: "QA Fixture Role",
      status: "interview",
    })
    .select("id")
    .single();
  if (applicationError) throw new Error(`could not create application: ${applicationError.message}`);

  const { data: interview, error: interviewError } = await admin
    .from("interviews")
    .insert({
      user_id: userId,
      application_id: application.id,
      stage: "Panel",
      status: "scheduled",
      meeting_provider: "Zoom",
    })
    .select("id")
    .single();
  if (interviewError || !interview) {
    throw new Error(`could not create interview: ${interviewError?.message}`);
  }
  return interview.id;
}

/**
 * A storage state for a signed-in candidate, on a caller-owned context.
 *
 * Signs in through the real `/login` form the first time an account is needed
 * and reuses the session afterwards (see `session-cache.ts`).
 */
export async function signedInStorageState(
  browser: import("@playwright/test").Browser,
  email: string,
  landing: RegExp,
  { loginPath = "/login" }: { loginPath?: string } = {}
) {
  return sessionFor(email, async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(loginPath);
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill(QA_PASSWORD);
      await Promise.all([
        page.waitForURL(landing, { timeout: 15000 }),
        page.locator('form button[type="submit"]').first().click(),
      ]);
      return await context.storageState();
    } finally {
      await context.close();
    }
  });
}
