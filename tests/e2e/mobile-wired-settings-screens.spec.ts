import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

// Phase 5 Batch C — the remaining wired screens (15, 16, 20, 21, 33) render
// real mobile presentations at phone width for a signed-in candidate.
// Requires a running local Supabase stack (same as logout.spec.ts).
//
// The screens need a session but not a completed resume, so the test marks
// onboarding complete directly via SQL (the same approach logout.spec.ts uses).
// The signup wizard is two-step at phone width: email/password, then name.
//
// SAFETY GUARD: this spec SIGNS UP A REAL USER. It must only ever run against
// the local Docker Supabase stack — never against a deployed project. The dev
// server has been pointed at http://127.0.0.1:54321 locally; the Playwright
// baseURL is localhost in either case, so require an explicit env toggle to
// run (set RUN_WIRED_SCREEN_E2E=1) in addition to the localhost check.

const baseURL = (process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").toLowerCase();
const localOnly = baseURL.includes("127.0.0.1") || baseURL.includes("localhost");
const runEnabled = process.env.RUN_WIRED_SCREEN_E2E === "1";

function containerForStack(): string {
  try {
    const lines = execSync(`docker ps --format "{{.Names}}"`, { encoding: "utf8" })
      .split("\n")
      .map((l) => l.trim());
    return (
      lines.find((l) => l.startsWith("supabase_db_")) ||
      "supabase_db_Odesseus-ai"
    );
  } catch {
    return "supabase_db_Odesseus-ai";
  }
}

test.describe("wired Phase 5 settings screens render for a signed-in user", () => {
  test.skip(
    !runEnabled || !localOnly,
    "requires RUN_WIRED_SCREEN_E2E=1 and the dev server pointed at the local Supabase stack"
  );

  test.use({ viewport: { width: 390, height: 844 } });

  test("screens 15/16/20/21/33 render their real mobile presentation", async ({
    page,
  }) => {
    const container = containerForStack();
    const stamp = Date.now();
    const email = `qa-settings-${stamp}@odesseusqa.dev`;
    const password = "TestPassword123!";

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/signup");
    // Single-page desktop signup form (deterministic server action submit).
    await page.fill('input[name="first_name"]', "Ada");
    await page.fill('input[name="last_name"]', "Lovelace");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await Promise.all([
      page.waitForURL("**/onboarding", { timeout: 20000 }),
      page.click('button.candidate-continue-button[type="submit"]'),
    ]);
    await page.setViewportSize({ width: 390, height: 844 });

    execSync(
      `docker exec ${container} psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c ` +
        `"update public.profiles set onboarding_completed = true from auth.users where profiles.id = auth.users.id and auth.users.email = '${email}';"`,
      { stdio: "inherit" }
    );

    const cases = [
      { route: "/settings/security", index: "15", title: "Password & Security" },
      { route: "/settings/notifications", index: "16", title: "Notifications" },
      { route: "/settings/appearance", index: "20", title: "Appearance" },
      { route: "/settings/referrals", index: "21", title: "Refer a Friend" },
      { route: "/report-job", index: "33", title: "Report Job" },
    ] as const;

    for (const { route, index, title } of cases) {
      await page.goto(route);
      await expect(page).toHaveURL(route);
      const screen = page.locator(`.m-screen-${index}`);
      await expect(screen).toBeVisible();
      await expect(screen.getByRole("heading", { name: title })).toBeVisible();
    }
  });
});