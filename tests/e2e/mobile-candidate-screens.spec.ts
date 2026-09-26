import { test, expect } from "@playwright/test";

// Phase 5 — mobile rendering boundary. These tests run against the real
// routes with a phone viewport (the playwright "mobile-chrome" Pixel 7
// project), asserting that the mobile presentation renders instead of the
// desktop layout, and that the auth boundary still holds at phone widths.
// They need no OpenAI/Stripe/Browserbase credentials, only a running dev
// server backed by local Supabase (same requirement as the existing e2e
// specs in this directory).

test.describe("mobile landing splash (screen 00)", () => {
  test("phone viewport renders the splash with the approved live-job stack", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator(".m-splash")).toBeVisible();
    // The desktop marketing landing must not leak in under the phone width.
    await expect(page.locator(".m-splash").getByRole("link", { name: /Get Started/i })).toBeVisible();
    // The Figma-approved job stack shows real company names as illustrative
    // live-job examples (product decision, not a data claim about real
    // openings) — verify the stack renders as designed.
    await expect(page.locator(".m-splash").getByText("Microsoft", { exact: false })).toBeVisible();
    await expect(page.locator(".m-splash").getByText("NVIDIA", { exact: false })).toBeVisible();
    await expect(page.locator(".m-splash").getByText("Amazon", { exact: false })).toBeVisible();
    await expect(page.locator(".m-splash").getByText("Google", { exact: false })).toBeVisible();
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

test.describe("mobile splash CTA area (screen 00)", () => {
  const viewports = [
    { name: "390x844", width: 390, height: 844 },
    { name: "393x852", width: 393, height: 852 },
    { name: "430x932", width: 430, height: 932 },
  ] as const;

  for (const vp of viewports) {
    test(`${vp.name}: pills sit side-by-side with a full-width View Pricing button below`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      const splash = page.locator(".m-splash");

      const getStarted = splash.getByRole("link", { name: /Get Started/i });
      const businessLogin = splash.getByRole("link", { name: "Business Login" });
      const viewPricing = splash.getByRole("link", { name: /View Pricing/i });

      await expect(getStarted).toBeVisible();
      await expect(businessLogin).toBeVisible();
      await expect(viewPricing).toBeVisible();
      await expect(getStarted).toHaveAttribute("href", "/signup");
      await expect(businessLogin).toHaveAttribute("href", "/employers/login");
      await expect(viewPricing).toHaveAttribute("href", "/pricing");

      const a = await splash.locator(".m-splash-cta").nth(0).boundingBox();
      const b = await splash.locator(".m-splash-cta").nth(1).boundingBox();
      const w = await splash.locator(".m-splash-cta-wide").boundingBox();
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(w).not.toBeNull();
      // Both pills share one row on the ~390px canvas and stay touch-friendly.
      expect(Math.abs(a!.y - b!.y)).toBeLessThanOrEqual(2);
      expect(a!.height).toBeGreaterThanOrEqual(48);
      // View Pricing sits on its own row below the pills and spans the column.
      expect(w!.y).toBeGreaterThan(b!.y + b!.height - 1);
      expect(w!.width).toBeGreaterThan(200);
    });

    test(`${vp.name}: splash CTAs route to signup, employer login, and pricing`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      const splash = page.locator(".m-splash");

      await splash.getByRole("link", { name: /Get Started/i }).click();
      await expect(page).toHaveURL(/\/signup$/);
      await page.goto("/");
      await splash.getByRole("link", { name: "Business Login" }).click();
      await expect(page).toHaveURL(/\/employers\/login$/);
      await page.goto("/");
      await splash.getByRole("link", { name: /View Pricing/i }).click();
      await expect(page).toHaveURL(/\/pricing$/);
    });
  }
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

test.describe("public mobile pages at phone width (signed out)", () => {
  const publicRoutes = [
    "/pricing",
    "/about",
    "/faq",
    "/support",
    "/legal",
    "/terms",
    "/privacy",
    "/accessibility",
    "/licenses",
    "/employers",
    "/employers/pricing",
    "/employers/login",
    "/signup",
    "/partners",
    "/how-it-works",
  ] as const;

  for (const route of publicRoutes) {
    test(`${route} stays public and never shows the authenticated bottom nav`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(route);
      // No redirect to the candidate login: the signed-out visitor lands on
      // the public route itself.
      expect(new URL(page.url()).pathname).toBe(route);
      await expect(page.locator("body")).toBeVisible();
      await expect(page.locator(".m-bottom-nav")).toHaveCount(0);
      await expect(page.locator(".mobile-app-bottom-nav")).toHaveCount(0);
    });
  }
});