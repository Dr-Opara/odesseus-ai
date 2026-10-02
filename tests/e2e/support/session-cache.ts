import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BrowserContext } from "@playwright/test";

/**
 * A real, server-issued Supabase session for one QA account, reused across the
 * tests and Playwright projects that need it.
 *
 * Why this exists: the local Supabase stack meters sign-ins and sign-ups
 * together, 30 requests per 5 minutes per IP (`sign_in_sign_ups` in
 * supabase/config.toml). Signing in once per test exhausts that bucket part-way
 * through the suite and every later spec fails with "Too many attempts" — a
 * test-infrastructure artifact that looks exactly like a product regression.
 *
 * Nothing is weakened to get it. The sign-in still goes through the real
 * `/login` form against the real server, and every page using a cached session
 * still sends a genuine Supabase session cookie on every request. Only the
 * repeated *login* is skipped, not the authenticated behaviour under test.
 *
 * The cache lives in `.qa-auth-cache/`, which is gitignored, is keyed by email,
 * and is written atomically so two workers provisioning the same account
 * concurrently cannot leave a half-written file behind. Entries are discarded
 * once the access token is close to expiry, so a stale session cannot produce a
 * confusing redirect to the login page.
 */
const CACHE_DIR = path.join(process.cwd(), ".qa-auth-cache");

/** Re-authenticate this long before the access token actually expires. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/**
 * A saved browser session: exactly what `context.storageState()` returns and
 * exactly what `browser.newContext({ storageState })` accepts, so the cached
 * value can be handed straight to Playwright without a cast.
 */
export type CachedSession = Awaited<ReturnType<BrowserContext["storageState"]>>;

function cachePath(email: string): string {
  return path.join(CACHE_DIR, `${email.replace(/[^a-z0-9@._-]/gi, "_")}.json`);
}

function readCached(email: string): CachedSession | null {
  try {
    const cached = JSON.parse(readFileSync(cachePath(email), "utf8")) as CachedSession;
    if (!Array.isArray(cached.cookies) || cached.cookies.length === 0) return null;
    const nearestExpiry = Math.min(...cached.cookies.map((c) => c.expires * 1000));
    return nearestExpiry - Date.now() > EXPIRY_MARGIN_MS ? cached : null;
  } catch {
    return null;
  }
}

function writeCached(email: string, session: CachedSession): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  // Write-then-rename: a reader never sees a partial file, and two workers
  // writing the same account both end up with a complete one.
  const temp = `${cachePath(email)}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(session));
  renameSync(temp, cachePath(email));
}

/**
 * Returns storage state for a signed-in account, signing in through the real
 * form only when there is no usable cached session.
 *
 * `signIn` must drive the actual login page and resolve with the storage state
 * the browser ended up holding.
 */
export async function sessionFor(
  email: string,
  signIn: () => Promise<CachedSession>
): Promise<CachedSession> {
  const cached = readCached(email);
  if (cached) return cached;

  const fresh = await signIn();
  writeCached(email, fresh);
  return fresh;
}

/** Drops a cached session so the next caller signs in again. */
export function forgetSession(email: string): void {
  try {
    rmSync(cachePath(email));
  } catch {
    // Nothing cached for this account, which is the normal case.
  }
}
