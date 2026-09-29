import { test, expect } from "@playwright/test";

// Candidates, Candidate Detail, and Pipeline (Checkpoint 5) — none of these
// are in the auth proxy's public paths, so they're protected by the same
// central role-aware redirect established in Checkpoint 4: a signed-out
// visitor lands on /employers/login, never the generic candidate /login.

const protectedRoutes = [
  "/employers/candidates",
  "/employers/candidates/some-candidate-id",
  "/employers/pipeline",
];

test.describe("candidates + pipeline auth boundary (Checkpoint 5)", () => {
  for (const route of protectedRoutes) {
    test(`${route} redirects a signed-out visitor to /employers/login`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/employers\/login/);
    });
  }
});
