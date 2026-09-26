import { test, expect } from "@playwright/test";

// These tests exercise the public/authenticated boundary against a running
// Next.js dev server backed by local Supabase (see docs/development/*.md
// for how to bring up the local stack). They require no OpenAI, Stripe,
// or Browserbase credentials — only Supabase auth's redirect behavior.

test.describe("landing page", () => {
  // The header's Sign In link is replaced by a hamburger menu below 680px
  // (covered separately in marketing-pages.spec.ts) — force a desktop
  // viewport here so this content check is viewport-independent.
  test.use({ viewport: { width: 1280, height: 800 } });

  test("loads and shows the primary calls to action", async ({ page }) => {
    await page.goto("/");
    // The H1 is intentionally screen-reader-only (the hero is a visual
    // job-search dashboard showcase with no visible headline) — check it's
    // present for accessibility/SEO rather than visible.
    await expect(
      page.getByRole("heading", { name: "Discover Your Dream Job with Odesseus.ai", level: 1 })
    ).toBeAttached();
    await expect(page.getByText("Scored from your resume")).toBeVisible();
    await expect(page.locator("header").getByRole("link", { name: "Sign In" })).toBeVisible();
    await expect(page.locator("header").getByRole("link", { name: "Get Started" })).toBeVisible();
  });
});

test.describe("login and signup pages", () => {
  test("login page renders the sign-in form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("signup page renders the account-creation form", async ({ page, isMobile }) => {
    await page.goto("/signup");
    await expect(
      page.getByRole("heading", { name: isMobile ? "Create your account" : "Create Account", level: 1 })
    ).toBeVisible();
    // Desktop and mobile signup forms both live in the DOM (the wrong one is
    // hidden by CSS), so scope every field assertion to the visible form.
    await expect(page.getByLabel(isMobile ? "Email" : "Email Address").filter({ visible: true })).toBeVisible();
    await expect(page.getByLabel("Password").filter({ visible: true })).toBeVisible();
  });

  // Desktop-only: the mobile wizard folds account creation into a two-step
  // flow without a cross-link back to login; the desktop pages keep the
  // explicit cross-links.
  test("login and signup pages link to each other", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/login");
    await page.getByRole("link", { name: "Create a candidate account" }).click();
    await expect(page).toHaveURL(/\/signup$/);

    await page.getByRole("link", { name: "Sign In" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("protected route boundary", () => {
  const protectedRoutes = [
    "/dashboard",
    "/onboarding",
    "/profile",
    "/match",
    "/applications",
    "/interviews",
    "/billing",
    "/integrations",
    // Regression coverage: /apply became a public marketing route, but the
    // authenticated Apply workflow nested under it must remain gated.
    "/apply/start",
    "/partners/dashboard",
    "/admin/partners",
    "/admin/system",
  ];

  for (const route of protectedRoutes) {
    test(`redirects an unauthenticated visitor from ${route} to /login`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/);
    });
  }
});

test.describe("public marketing routes", () => {
  // /live is intentionally public but now redirects to the agents page (the
  // three-core-agent simplification), so its public-route check asserts the
  // redirect target rather than the literal path.
  const publicRoutes = [
    "/how-it-works",
    "/apply",
    "/live",
    "/pricing",
    "/about",
    "/partners",
    "/partners/apply",
    "/partners/terms",
  ];

  for (const route of publicRoutes) {
    test(`does not redirect an unauthenticated visitor away from ${route}`, async ({ page }) => {
      await page.goto(route);
      if (route === "/live") {
        await expect(page).toHaveURL(/\/agents/);
      } else {
        await expect(page).toHaveURL(new RegExp(`${route}$`));
      }
      await expect(page).not.toHaveURL(/\/login/);
    });
  }
});