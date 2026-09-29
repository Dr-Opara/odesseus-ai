import { test, expect } from "@playwright/test";

// Role-selection sign-in chooser (F1-A "Sign in" entry point / F13-A). The
// public "Sign in" CTA must route here first, and each card must hand off to
// the correct existing flow — never straight into the candidate dashboard.

test("homepage 'Sign In' nav link routes to the chooser", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.locator(".figma-nav-actions").getByRole("link", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole("heading", { name: "Welcome Back" })).toBeVisible();
});

test("Job Seeker card routes to candidate sign-in", async ({ page }) => {
  await page.goto("/signin");
  await page.getByRole("link", { name: /Job Seeker/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("CANDIDATE SIGN IN ONLY")).toBeVisible();
});

test("Employer card routes to employer sign-in, not the candidate dashboard", async ({ page }) => {
  await page.goto("/signin");
  await page.getByRole("link", { name: /Employer/ }).click();
  await expect(page).toHaveURL(/\/employers\/login$/);
  await expect(page).not.toHaveURL(/\/dashboard$/);
});
