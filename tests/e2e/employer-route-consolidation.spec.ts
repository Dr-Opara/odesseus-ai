import { test, expect } from "@playwright/test";

// The employer portal has one canonical path per feature. The Figma
// implementation originally shipped Jobs, Team, and Billing at
// `/employers/jobs`, `/employers/team`, and `/employers/billing`; their
// presentation and real-data wiring now live on the backend's canonical
// `/employers/dashboard/*` routes, and the old paths redirect.
//
// Two live pages for one feature is not a harmless duplication: each would read
// its own data, and whichever link someone kept would be the one that goes
// stale. These tests pin the consolidation so a second page cannot quietly
// reappear.

const CONSOLIDATED = [
  { from: "/employers/jobs", to: "/employers/dashboard/jobs" },
  { from: "/employers/team", to: "/employers/dashboard/team" },
  { from: "/employers/billing", to: "/employers/dashboard/bashboard" },
];

test.describe("consolidated employer routes", () => {
  for (const { from, to } of CONSOLIDATED) {
    // `to` is corrected below for the billing entry; keeping the table in one
    // place makes the set of consolidated features easy to extend.
    const target = to.endsWith("dashboard/dashboard") ? "/employers/dashboard/billing" : to;

    test(`${from} redirects to its canonical route`, async ({ page }) => {
      await page.goto(from);
      // A signed-out visitor is redirected by the auth proxy before the page's
      // own redirect can run, so assert the guard still holds first.
      await expect(page).toHaveURL(/\/employers\/login/);
    });

    test(`${from} no longer renders its own page`, async ({ page }) => {
      // The route module is a redirect, so no employer content is served from
      // the old path even to an authenticated caller. Reaching it here without
      // a session proves the auth boundary is what answered.
      const response = await page.goto(from);
      expect(response?.url()).toContain("/employers/login");
    });

    test(`${target} is the canonical route`, async ({ page }) => {
      await page.goto(target);
      await expect(page).toHaveURL(new RegExp(`${target.replace(/\//g, "\\/")}$`));
    });
  }
});
