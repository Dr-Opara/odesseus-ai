import { test, expect } from "@playwright/test";

// Analytics, Billing, Featured Jobs, Team, Notifications (Checkpoint 6) — all
// protected by the same central role-aware auth boundary from Checkpoint 4.

const protectedRoutes = [
  "/employers/analytics",
  "/employers/dashboard/billing",
  "/employers/jobs/some-job-id/feature",
  "/employers/dashboard/team",
  "/employers/notifications",
];

test.describe("analytics/billing/team/notifications auth boundary (Checkpoint 6)", () => {
  for (const route of protectedRoutes) {
    test(`${route} redirects a signed-out visitor to /employers/login`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/employers\/login/);
    });
  }
});

test.describe("employer billing stays separate from candidate wallet billing", () => {
  test("/billing (candidate) and /employers/billing (employer) are distinct routes", async ({ page }) => {
    await page.goto("/employers/dashboard/billing");
    await expect(page).toHaveURL(/\/employers\/login/);
    // Candidate billing requires its own (candidate) session — confirm the
    // two surfaces don't collapse into the same redirect/route by checking
    // /billing separately redirects through the candidate flow.
    await page.goto("/billing");
    await expect(page).not.toHaveURL(/\/employers\/login/);
  });
});
