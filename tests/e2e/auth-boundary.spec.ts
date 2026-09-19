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
    await expect(page.getByRole("heading", { name: "Your next move, handled." })).toBeVisible();
    await expect(page.locator("header").getByRole("link", { name: "Sign In" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Get Started Free" })).toBeVisible();
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

  test("signup page renders the account-creation form", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: "Meet Odysseus." })).toBeVisible();
    await expect(page.getByLabel("Name")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
  });

  test("login and signup pages link to each other", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(/\/signup$/);

    await page.getByRole("link", { name: "Sign in" }).click();
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
  ];

  for (const route of protectedRoutes) {
    test(`redirects an unauthenticated visitor from ${route} to /login`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/);
    });
  }
});

test.describe("public marketing routes", () => {
  const publicRoutes = ["/how-it-works", "/apply", "/live", "/pricing", "/about"];

  for (const route of publicRoutes) {
    test(`does not redirect an unauthenticated visitor away from ${route}`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(new RegExp(`${route}$`));
      await expect(page).not.toHaveURL(/\/login/);
    });
  }
});
