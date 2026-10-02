import { test, expect } from "@playwright/test";

// Employer auth + onboarding + Company Profile (Checkpoint 3). Signed-out
// visitors must land on /employers/login (not the generic candidate /login)
// - these routes are in the proxy's public-path allowlist specifically so
// each page's own auth guard (not the generic middleware) decides that.

const protectedEmployerRoutes = [
  "/employers/onboarding/company",
  "/employers/onboarding/plan",
  "/employers/onboarding/review",
  "/employers/company",
];

test.describe("employer onboarding + company profile route protection", () => {
  for (const route of protectedEmployerRoutes) {
    test(`${route} redirects a signed-out visitor to /employers/login, not /login`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/employers\/login/);
    });
  }
});

// Employer auth surfaces ship two presentations and only CSS decides which one
// shows, so each assertion is pinned to a desktop width. Running these in the
// phone Playwright projects asserted desktop copy against a page rendering its
// mobile copy — a harness bug, not a product one: the mobile headings are
// covered in employer-portal.spec.ts.

test.describe("employer sign-in copy matches Figma screen 05", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("/employers/login shows 'Employer Sign In' heading", async ({ page }) => {
    await page.goto("/employers/login");
    await expect(page.getByRole("heading", { name: "Employer Sign In" })).toBeVisible();
  });
});

test.describe("employer signup copy matches Figma screen 69", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("/employers/signup shows 'Create your employer account.' heading", async ({ page }) => {
    await page.goto("/employers/signup");
    await expect(
      page.getByRole("heading", { name: "Create your employer account.", level: 1 })
    ).toBeVisible();
  });
});
