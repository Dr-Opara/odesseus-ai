import { test, expect } from "@playwright/test";

// Phase 9B admin console: the gate lives server-side in src/lib/admin/auth.ts
// (requireAdmin, enforced from src/app/admin/layout.tsx plus every mutating
// server action). These tests enforce that boundary end-to-end rather than
// trusting that hidden navigation alone keeps non-admins out.

const ADMIN_ROUTES = [
  "/admin",
  "/admin/users",
  "/admin/wallets",
  "/admin/applications",
  "/admin/employers",
  "/admin/jobs",
  "/admin/careers",
  "/admin/partners",
  "/admin/referrals",
  "/admin/billing",
  "/admin/live",
  "/admin/system",
] as const;

test.describe("admin console authorization boundary", () => {
  for (const route of ADMIN_ROUTES) {
    test(`signed-out visitor to ${route} is redirected to /login`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/);
    });
  }

  test("a signed-in non-admin candidate is redirected away from the admin console", async ({ page }) => {
    // Deterministic desktop signup (the mobile signup is a two-step wizard
    // with different field selectors) — mirrors tests/e2e/live-visibility.spec.ts.
    await page.setViewportSize({ width: 1280, height: 800 });

    const stamp = Date.now();
    const email = `qa-admin-boundary-${stamp}@example.com`;
    const password = "TestPassword123!";

    await page.goto("/signup");
    await page.fill('input[name="first_name"]', "Ada");
    await page.fill('input[name="last_name"]', "Lovelace");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await Promise.all([
      page.waitForURL("**/onboarding", { timeout: 15000 }),
      page.click('button.candidate-continue-button[type="submit"]'),
    ]);

    // requireAdmin() redirects a non-admin to /dashboard; an account that
    // hasn't finished onboarding is then redirected again to /onboarding.
    // Either landing spot is fine — the property under test is that the
    // visitor never reaches the admin console itself.
    for (const route of ["/admin", "/admin/users", "/admin/wallets"]) {
      await page.goto(route);
      await expect(page).not.toHaveURL(new RegExp(`${route}$`));
      expect(new URL(page.url()).pathname.startsWith("/admin")).toBe(false);
    }
  });
});
