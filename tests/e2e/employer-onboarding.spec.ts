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

test.describe("employer sign-in copy matches Figma screen 05", () => {
  test("/employers/login shows 'Employer Sign In' heading", async ({ page }) => {
    await page.goto("/employers/login");
    await expect(page.getByRole("heading", { name: "Employer Sign In" })).toBeVisible();
  });
});

test.describe("employer signup copy matches Figma screen 69", () => {
  test("/employers/signup shows 'Create your employer account.' heading", async ({ page }) => {
    await page.goto("/employers/signup");
    await expect(page.getByRole("heading", { name: "Create your employer account." })).toBeVisible();
  });
});
