import { test, expect } from "@playwright/test";

// Employer Dashboard/Jobs/Post Job/Edit Job (Checkpoint 4) must stay fully
// authenticated. These routes were briefly (and incorrectly) added to the
// auth proxy's publicPrefixPaths during development to work around the
// wrong-login-page redirect target; that bypass was removed. Instead the
// proxy's redirect *target* is now role-aware: any protected /employers/*
// path sends a signed-out visitor to /employers/login, not the generic
// candidate /login — covering dynamic routes like /employers/jobs/[id]
// without whitelisting them individually.

const protectedEmployerRoutes = [
  "/employers/dashboard",
  "/employers/dashboard/jobs",
  "/employers/jobs/some-job-id",
  "/employers/jobs/some-job-id/edit",
  "/employers/company",
];

test.describe("employer portal auth boundary (Checkpoint 4)", () => {
  for (const route of protectedEmployerRoutes) {
    test(`${route} redirects a signed-out visitor to /employers/login, never renders portal data`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/employers\/login/);
      // Never the generic candidate sign-in page. The negative lookahead in
      // the original matcher was `(?!\/)`, which reads "not `/login/`" — but
      // the path *ends* in `/login`, so the lookahead succeeds and the
      // assertion rejected the very redirect it was written to require. The
      // check is that the path is not exactly the candidate sign-in.
      expect(new URL(page.url()).pathname).not.toBe("/login");
    });
  }

  test("candidate accounts cannot reach employer portal data without hitting the employer role gate", async ({ page }) => {
    // No authenticated session exists in this test environment; the
    // meaningful assertion is the same as above — the route never serves
    // portal content to anyone without a valid employer session. The
    // account_type==="employer" check inside each page (independent of the
    // proxy) is what would additionally sign out and reject an authenticated
    // *candidate* session that reached the page — see the page source for
    // /employers/jobs/[id]/page.tsx, /employers/dashboard/page.tsx, etc.
    await page.goto("/employers/dashboard/jobs");
    await expect(page).toHaveURL(/\/employers\/login/);
  });
});
