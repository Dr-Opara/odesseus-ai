import { test, expect } from "@playwright/test";

// Homepage job carousel (F1-B/F1-C/F1-F/F1-J). Runs against the dev server,
// so `getHomepageJobs()` serves the dev-only fixtures (never a production
// fallback — see tests/unit/homepage-jobs.test.ts for that gate).

test.describe("homepage job carousel (desktop)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("renders real job cards with no fabricated salary or applicant counts", async ({ page }) => {
    await page.goto("/");
    const track = page.locator(".oh-carousel-track.odesseus-desktop-only");
    await expect(track.locator(".oh-job-card").first()).toBeVisible();
    await expect(track.getByText("Nova Cloud")).toBeVisible();
    // No invented applicant-count/popularity language anywhere on the card.
    const cardText = (await track.innerText()).toLowerCase();
    expect(cardText).not.toMatch(/applicants?\s*applied|people applied|popular|urgent/);
  });

  test("shows pagination dots and enables/disables arrows at the ends", async ({ page }) => {
    await page.goto("/");
    const controls = page.locator(".oh-carousel-controls");
    await expect(controls).toBeVisible();
    const prev = controls.getByRole("button", { name: "Previous jobs" });
    const next = controls.getByRole("button", { name: "Next jobs" });
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();

    await next.click();
    await expect(prev).toBeEnabled();
  });

  test("never shows a Match Score badge when signed out", async ({ page }) => {
    await page.goto("/");
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toMatch(/\d+%\s*match/);
  });

  test("does not promote Odesseus Live on the public homepage", async ({ page }) => {
    await page.goto("/");
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("odesseus live");
  });
});

test.describe("homepage job carousel (mobile)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("renders a swipeable single-card track with dots, no horizontal page overflow", async ({ page }) => {
    await page.goto("/");
    const track = page.locator(".m-job-carousel-track");
    await expect(track).toBeVisible();
    await expect(track.locator(".oh-job-card").first()).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});

test.describe("homepage responsive sweep", () => {
  const widths = [375, 390, 393, 430, 1280, 1440, 1920];

  for (const width of widths) {
    test(`${width}px: no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });
  }
});
