/**
 * Real local-stack integration harness.
 *
 * Signs in through the real GoTrue flow using `@supabase/ssr` with an
 * in-process cookie store, then replays the exact cookies the server set as a
 * `Cookie` header against the dev server. No mock, no fabricated session: the
 * JWT is the one Supabase issued and the browser would carry the same cookie.
 *
 * The keys come from the environment, never from this file. `supabase start`
 * prints them (`npx supabase status`) and `.env.local` already carries them for
 * the dev server, so the harness reads the same values the app does. Hardcoding
 * them would be a credential in version control even though these are
 * local-stack values -- and GitHub's secret scanner is right to refuse one.
 *
 * Run with: node scripts/local-flow-<n>-<name>.mjs [baseUrl]
 */
import { createServerClient } from "@supabase/ssr";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!PUBLISHABLE || !SERVICE) {
  console.error(
    "\n  These flows need the local stack's keys in the environment.\n" +
      "  Put them in .env.local (gitignored) -- `npx supabase status` prints them --\n" +
      "  or export them for this shell. The harness deliberately does not carry\n" +
      "  them itself.\n"
  );
  process.exit(2);
}

const results = [];
let failures = 0;

function record(group, name, ok, detail = "") {
  results.push({ group, name, ok, detail });
  if (!ok) failures++;
  const tag = ok ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${name}${detail ? `  -- ${detail}` : ""}`);
}

async function admin(path, options = {}) {
  const r = await fetch(`${SUPA}${path}`, {
    ...options,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: r.status, json, text };
}

/**
 * Create a confirmed user and return a cookie header carrying a real session.
 *
 * `metadata` is written to `user_metadata`, which is where the app reads
 * `account_type` from. An employer signup has to carry it, so a test that wants
 * the employer surface has to set it -- otherwise the org route correctly
 * refuses with "Employer signup is required", which is the product working.
 */
async function signIn(email, password, metadata = {}) {
  const store = new Map();
  const client = createServerClient(SUPA, PUBLISHABLE, {
    cookies: {
      getAll: () => [...store].map(([name, value]) => ({ name, value })),
      setAll: (list) => { for (const { name, value } of list) store.set(name, value); },
    },
  });

  const created = await admin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (created.status >= 400 && created.status !== 422) {
    throw new Error(`create user ${email}: ${created.status} ${created.text}`);
  }
  const userId = created.json?.id ?? created.json?.user?.id;

  if (Object.keys(metadata).length > 0 && userId) {
    const updated = await admin(`/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: metadata,
      }),
    });
    if (updated.status >= 400) {
      throw new Error(`set metadata for ${email}: ${updated.status} ${updated.text}`);
    }
  }

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);

  return {
    email,
    userId: data.user.id,
    accessToken: data.session.access_token,
    cookie: [...store].map(([k, v]) => `${k}=${v}`).join("; "),
  };
}

async function call(session, method, path, body) {
  const headers = { Cookie: session.cookie, "Content-Type": "application/json" };
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: r.status, json, text };
}

export { BASE, SUPA, SERVICE, PUBLISHABLE, admin, signIn, call, record, results };

/**
 * Grant job-post credits the way the subscription webhook does.
 *
 * There is no grant RPC on purpose: credits are an entitlement, so they are only
 * ever written by the billing path. Inserting the row directly through the
 * service role reproduces exactly what that path leaves behind, which is the
 * state a publish is supposed to consume. Using an RPC would be inventing a
 * second way to grant them.
 */
export async function grantJobPostCredits(orgId, total = 5) {
  const res = await admin("/rest/v1/employer_job_post_credits", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      org_id: orgId,
      total,
      used: 0,
      granted_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    }),
  });
  return res;
}

/**
 * Put the org on an active plan so capacity checks have a ceiling to read.
 *
 * `publishJob` refuses with `no_credits` when the org has no *active*
 * subscription, so an active row is a precondition for the publish path, not a
 * detail. Column names are `period_start` / `period_end`.
 */
export async function grantSubscription(orgId, tier = "growth", included = 10) {
  const res = await admin("/rest/v1/employer_subscriptions", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      org_id: orgId,
      tier,
      status: "active",
      job_posts_included: included,
      period_start: new Date().toISOString(),
      period_end: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    }),
  });
  return res;
}

/** Add a member to an org, as an invitation acceptance would. */
export async function addMember(orgId, userId, role) {
  return admin("/rest/v1/employer_members", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ org_id: orgId, user_id: userId, role }),
  });
}

export const summary = () => {
  console.log(`\n${results.length - failures}/${results.length} passed`);
  return failures;
};
