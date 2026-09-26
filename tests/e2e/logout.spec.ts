import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

// Regression test for a bug found during local runtime QA: the dashboard
// header rendered a plain, non-interactive avatar div with no logout
// control anywhere in the UI, even though the `logout` server action was
// already implemented — there was simply no way to sign out of Odesseus.
// Requires a running local Supabase stack (see docs/development/*.md).
//
// Onboarding completion (which needs a real resume upload) is exercised
// separately in manual/scripted QA — this test only needs a user who has
// already completed it, so it marks the profile complete directly via SQL
// rather than re-driving the upload flow.

function dbContainer(): string {
  try {
    const lines = execSync(`docker ps --format "{{.Names}}"`, { encoding: "utf8" })
      .split("\n")
      .map((l) => l.trim());
    const found = lines.find((l) => l.startsWith("supabase_db_"));
    if (found) return found;
  } catch {
    // fall through to the default name
  }
  return "supabase_db_Odysseus-ai";
}

test("a signed-up user can log out from the dashboard, and the session is really cleared server-side", async ({
  page,
}) => {
  const stamp = Date.now();
  const email = `qa-logout-${stamp}@example.com`;
  const password = "TestPassword123!";

  // The signup flow is two-step at phone width, so run the desktop
  // single-page form for a deterministic sign-up (same as the wired
  // settings screen spec).
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/signup");
  await page.fill('input[name="first_name"]', "Grace");
  await page.fill('input[name="last_name"]', "Hopper");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL("**/onboarding", { timeout: 15000 }),
    page.click('button.candidate-continue-button[type="submit"]'),
  ]);

  execSync(
    `docker exec ${dbContainer()} psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c ` +
      `"update public.profiles set onboarding_completed = true from auth.users where profiles.id = auth.users.id and auth.users.email = '${email}';"`,
    { stdio: "inherit" }
  );

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.locator(".account-menu summary").click();
  const logoutButton = page.getByRole("button", { name: "Log out" });
  await expect(logoutButton).toBeVisible();

  await Promise.all([page.waitForURL("**/login", { timeout: 15000 }), logoutButton.click()]);
  await expect(page).toHaveURL(/\/login/);

  // The session must be invalidated server-side, not just redirected
  // client-side — revisiting a protected route must bounce back to /login.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);

  // And logging back in with the same credentials must still work.
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL("**/dashboard", { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);
  await expect(page).toHaveURL(/\/dashboard$/);
});
