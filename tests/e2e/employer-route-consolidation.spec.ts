import { test, expect } from "@playwright/test";

// The employer portal has one canonical path per feature. The Figma
// implementation originally shipped Jobs, Team, and Billing at
// `/employers/jobs`, `/employers/team`, and `/employers/billing`; their
// presentation and real-data wiring now live on the backend's canonical
// `/employers/dashboard/*` routes, and the old paths redirect.
//
// Two live pages for one feature is not a harmless duplication: each would read
// its own data, and whichever link someone kept would be the one that goes
// stale.
//
// Which layer proves what: the redirect *targets* cannot be observed from a
// signed-out browser, because the auth proxy answers first and sends every
// protected path to /employers/login before the page's own redirect can run.
// That mapping is asserted where it is actually visible, in
// tests/unit/employer-portal-ui.test.ts, which reads the route modules
// directly. What belongs here is the browser-visible half: none of these paths
// serves portal content to anyone without a valid employer session, whichever
// of them they are.

const PORTAL_PATHS = [
  "/employers/jobs",
  "/employers/dashboard/jobs",
  "/employers/team",
  "/employers/dashboard/team",
  "/employers/billing",
  "/employers/dashboard/billing",
] as const;

test.describe("consolidated employer routes", () => {
  for (const path of PORTAL_PATHS) {
    test(`${path} is behind the employer auth boundary`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/employers\/login/);

      // Never the generic candidate sign-in page.
      expect(new URL(page.url()).pathname).not.toBe("/login");

      // And never any portal content on the way there.
      const body = await page.locator("body").innerText();
      expect(body).not.toMatch(/job postings|recruiter seats|current subscription|manage seats/i);
    });
  }
});
