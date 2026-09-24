import { test, expect } from "@playwright/test";

// Phase 5 — mobile rendering boundary. These tests run against the real
// routes with a phone viewport (the playwright "mobile-chrome" Pixel 7
// project), asserting that the mobile presentation renders instead of the
// desktop layout, and that the auth boundary still holds at phone widths.
// They need no OpenAI/Stripe/Browserbase credentials, only a running dev
// server backed by local Supabase (same requirement as the existing e2e
// specs in this directory).

test.describe("mobile landing splash (screen 00)", () => {
  test("phone viewport renders the splash without fake job examples", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator(".m-splash")).toBeVisible();
    // The desktop marketing landing must not leak in under the phone width.
    await expect(page.locator(".m-splash").getByRole("link", { name: /Get Started/i })).toBeVisible();
    // No hardcoded employer/comp examples may appear on the public splash.
    await expect(page.getByText("Microsoft", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Amazon", { exact: false })).toHaveCount(0);
  });

  test("desktop viewport renders the real marketing landing, not the splash", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    // The splash shell is mobile-only.
    await expect(page.locator(".m-splash")).toBeHidden();
    // Desktop hero headline is present and instead a screen-reader-only h1.
    await page.getByRole("heading", { name: "Discover Your Dream Job with Odesseus.ai" }).waitFor();
    await expect(page.getByRole("heading", { name: "Discover Your Dream Job with Odesseus.ai" })).toBeVisible();
  });
});

test.describe("mobile auth boundary at phone width", () => {
  const protectedRoutes = [
    "/dashboard",
    "/jobs",
    "/applications",
    "/profile",
    "/billing",
    // Phase 5 Batch B: the real wired settings sub-route and the resume
    // review route both re-check the session server-side before rendering.
    "/settings/documents",
    "/resume-tailoring/00000000-0000-0000-0000-000000000000",
    // Phase 5 Batch C: the remaining wired settings sub-routes and the
    // report-job route re-check the session server-side before rendering.
    "/settings/security",
    "/settings/notifications",
    "/settings/job-preferences",
    "/settings/language-region",
    "/settings/appearance",
    "/settings/referrals",
    "/report-job",
  ] as const;

  for (const route of protectedRoutes) {
    test(`redirects an unauthenticated visitor from ${route} to /login at phone width`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/);
    });
  }

  test("login page renders the sign-in form at phone width", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
  });
});