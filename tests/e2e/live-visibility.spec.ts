import { test, expect } from "@playwright/test";

// Odesseus Live is a private, applicant-only feature. These tests enforce
// both directions of that visibility contract:
//
//  1. Signed-out visitors never encounter Odesseus Live — its name, the
//     session/pass/annual prices, or any live-interview workflow — on any
//     public page: marketing pages, public pricing, About/FAQ/Support,
//     employer pages, the public navigation, and the desktop nav/footer.
//     On phones the public entry points are owned by the splash
//     (Get Started / Business Login / See Pricing), and neither the marketing
//     nor the employer header renders a collapsible menu at any width.
//  2. A signed-in applicant still sees Odesseus Live where intended
//     (billing keeps the feature and the interview-pass balance exposed).
//
// The pricing tokens reflect the public advertising ban: no "$24.99 Live
// session", "3 Live passes $59.99", or "Annual Live $499" anywhere signed out.

const FORBIDDEN = ["odesseus live", "$24.99", "$59.99", "$499"] as const;

// Every route the auth boundary proxy marks public (see src/lib/supabase/proxy.ts):
// the splash, public pricing, marketing/help pages, and the employer site.
const PUBLIC_ROUTES = [
  "/",
  "/pricing",
  "/about",
  "/faq",
  "/support",
  "/how-it-works",
  "/apply",
  "/agents",
  "/live", // statically redirects to /agents — still public, still no Live ad
  "/partners",
  "/signup",
  "/login",
  "/check-email",
  "/employers",
  "/employers/pricing",
  "/employers/login",
  "/employers/signup",
  "/employers/post-job",
  "/terms",
  "/privacy",
  "/legal",
  "/accessibility",
  "/licenses",
] as const;

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  // Tablet band: the marketing collapse rule hides desktop nav links below
  // 900px while the mobile-only toggle kicks in at 767px, so 820px is the
  // exact width where an employer/candidate hamburger could leak through.
  { name: "tablet 820x900", width: 820, height: 900 },
  { name: "mobile 390x844", width: 390, height: 844 },
] as const;

test.describe("signed-out public surfaces never mention Odesseus Live", () => {
  for (const vp of VIEWPORTS) {
    for (const path of PUBLIC_ROUTES) {
      test(`${vp.name}: ${path} has no Odesseus Live naming or pricing`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(path);
        const body = (await page.locator("body").innerText()).toLowerCase();
        for (const token of FORBIDDEN) {
          expect(body, `${path} must not contain "${token}"`).not.toContain(token);
        }
      });
    }
  }

  test("the desktop nav and footer carry no Live entry", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const header = (await page.locator("header").innerText()).toLowerCase();
    const footer = (await page.locator(".figma-footer").innerText()).toLowerCase();
    const text = `${header} ${footer}`;
    for (const token of FORBIDDEN) {
      expect(text).not.toContain(token);
    }
  });

  test("the public mobile header has no collapsible menu at all", async ({ page }) => {
    // Signed-out phone navigation is owned by the splash (Get Started /
    // Business Login / See Pricing). The shared marketing header collapses
    // to the wordmark and carries no hamburger, so it cannot introduce a
    // second Sign In / Get Started pair — or any Live entry — on mobile.
    for (const width of [390, 820]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/how-it-works");
      await expect(page.locator(".figma-nav-toggle")).toHaveCount(0);
      await expect(page.locator(".figma-nav-mobile")).toHaveCount(0);
      const header = (await page.locator("header").innerText()).toLowerCase();
      for (const token of FORBIDDEN) {
        expect(header).not.toContain(token);
      }
    }
  });

  test("the employer header has no mobile menu and is hidden on phones", async ({ page }) => {
    // Employer Home / Pricing / For Candidates / Sign In / Post a Job are
    // desktop-only. They must not reappear in a phone-width or tablet-width
    // employer menu, because on phones the splash routes (Get Started /
    // Business Login / See Pricing) are the public business entry points.
    for (const width of [390, 820]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/employers");
      await expect(page.locator(".figma-nav-toggle")).toHaveCount(0);
      await expect(page.locator(".figma-nav-mobile")).toHaveCount(0);
    }

    // Under the mobile breakpoint the employer header is not rendered at all.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/employers");
    await expect(page.locator(".figma-nav")).toBeHidden();
  });

  test("the desktop employer navigation still carries Sign In and Post a Job", async ({ page }) => {
    // Removing the mobile menu must not touch desktop navigation.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/employers");
    const links = page.locator(".figma-nav");
    for (const label of ["Employer Home", "Pricing", "For Candidates", "Sign In", "Post a Job"]) {
      await expect(links.getByRole("link", { name: label })).toBeVisible();
    }
  });
});

test.describe("signed-in applicants still see Odesseus Live where intended", () => {
  // Deterministic desktop signup (the mobile signup is a two-step flow),
  // mirroring logout.spec — then check /billing, which is auth-gated and
  // exposes the Live feature plus the interview-pass balance. Live session
  // pricing/offers live in the billing catalog behind this boundary.
  test("billing keeps the Odesseus Live feature and interview-pass balance", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    const stamp = Date.now();
    const email = `qa-live-vis-${stamp}@example.com`;
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

    // /billing only needs a session (no onboarding gate) and is the public
    // page that becomes Live-aware once authenticated.
    await page.goto("/billing");
    await expect(page).toHaveURL(/\/billing$/);
    await expect(page.getByText(/One pass is used when Odesseus Live starts/i)).toBeVisible();
    await expect(page.getByText("Interview passes")).toBeVisible();

    // The legacy application-credit balance is gone from the candidate UI.
    // /billing now leads with the wallet, which is the only currency that can
    // start an application.
    await expect(page.getByText("Wallet", { exact: true })).toBeVisible();
    await expect(page.getByText(/app credits|application credits/i)).toHaveCount(0);
  });
});