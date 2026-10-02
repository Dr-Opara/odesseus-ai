import { test, expect } from "@playwright/test";
import { ensureCandidate, QA_PASSWORD, serviceClient } from "./support/qa-candidate";

// Regression test for a bug found during local runtime QA: the dashboard
// header rendered a plain, non-interactive avatar div with no logout
// control anywhere in the UI, even though the `logout` server action was
// already implemented — there was simply no way to sign out of Odesseus.
// Requires a running local Supabase stack (see docs/development/*.md).
//
// The account is provisioned with the service role rather than by driving
// /signup: the local stack meters sign-ins and sign-ups together across the
// whole suite, and this test runs in all three Playwright projects. See
// tests/e2e/support/qa-candidate.ts. The sign-up form itself is covered in
// live-visibility.spec.ts and auth-boundary.spec.ts.
//
// Onboarding completion (which needs a real resume upload) is exercised
// separately in manual/scripted QA — this test only needs a user who has
// already completed it, so it marks the profile complete directly against the
// database rather than re-driving the upload flow. That write goes through
// PostgREST instead of `docker exec psql`, which also removes this test's
// dependency on a container name and on docker being on PATH.

const LOGOUT_EMAIL = "qa.logout@odesseus-test.dev";

test("a signed-in user can log out from the dashboard, and the session is really cleared server-side", async ({
  browser,
}) => {
  const { userId } = await ensureCandidate(LOGOUT_EMAIL);

  const admin = serviceClient();
  const { error: onboardingError } = await admin!
    .from("profiles")
    .update({ onboarding_completed: true })
    .eq("id", userId);
  if (onboardingError) throw new Error(`could not complete onboarding: ${onboardingError.message}`);

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto("/login");
  await page.fill('input[name="email"]', LOGOUT_EMAIL);
  await page.fill('input[name="password"]', QA_PASSWORD);
  await Promise.all([
    page.waitForURL("**/dashboard", { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.locator(".account-menu summary").click();
  const logoutButton = page.getByRole("button", { name: "Log out" });
  await expect(logoutButton).toBeVisible();

  await Promise.all([page.waitForURL("**/login", { timeout: 15000 }), logoutButton.click()]);
  await expect(page).toHaveURL(/\/login/);

  // The session must be invalidated server-side, not just redirected
  // client-side — revisiting a protected route must bounce back to /login.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);

  // And logging back in with the same credentials must still work.
  await page.goto("/login");
  await page.fill('input[name="email"]', LOGOUT_EMAIL);
  await page.fill('input[name="password"]', QA_PASSWORD);
  await Promise.all([
    page.waitForURL("**/dashboard", { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);
  await expect(page).toHaveURL(/\/dashboard$/);

  await context.close();
});
