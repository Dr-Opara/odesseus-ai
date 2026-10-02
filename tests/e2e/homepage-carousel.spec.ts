import { test, expect } from "@playwright/test";

// Homepage job carousel (F1-B/F1-C/F1-F/F1-J). Runs against the dev server,
// so `getHomepageJobs()` serves the dev-only fixtures (never a production
// fallback — see tests/unit/homepage-jobs.test.ts for that gate).

test.describe("homepage job carousel (desktop)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("renders real job cards with no fabricated salary or applicant counts", async ({ page }) => {
    await page.goto("/");
    // Two tracks are mounted (mobile splash + desktop landing); only the one for
    // this width is visible, so every read is scoped to it.
    const track = page.locator(".oh-carousel-track.odesseus-desktop-only").filter({ visible: true });
    await expect(track.locator(".oh-job-card").first()).toBeVisible();
    // Company names come from the real feed, so the assertion is about the
    // card carrying a company at all rather than a fixture name: an earlier
    // version hardcoded "Nova Cloud", which only ever passed against the
    // dev-only fixture feed that has since been removed in favour of real rows.
    await expect(track.locator(".oh-job-company").first()).not.toBeEmpty();
    // No invented applicant-count/popularity language anywhere on the card.
    const cardText = (await track.innerText()).toLowerCase();
    expect(cardText).not.toMatch(/applicants?\s*applied|people applied|popular|urgent/);
  });

  test("pages the desktop carousel only when there is more than one page", async ({ page }) => {
    await page.goto("/");

    // The mobile splash and the desktop landing each mount the shared
    // HomepageBody, so every one of these exists twice — once per copy — and
    // only the copy for the current width is visible. Count visible cards.
    const readCards = () =>
      page.evaluate(() =>
        Array.from(
          document.querySelectorAll<HTMLElement>(
            ".oh-carousel-track.odesseus-desktop-only .oh-job-card"
          )
        )
          .filter((el) => el.offsetParent !== null)
          .map((el) => el.querySelector(".oh-job-company")?.textContent ?? "")
      );

    const controls = page.locator(".oh-carousel-controls").filter({ visible: true });
    const firstPage = await readCards();
    // The desktop carousel pages three at a time (DESKTOP_PAGE_SIZE in
    // src/components/job-carousel.tsx).
    const pages = Math.ceil(firstPage.length / 3);

    if (pages <= 1) {
      // One page. Arrows that cannot go anywhere would be a control that lies,
      // so their absence is the correct behaviour rather than a defect.
      await expect(controls).toHaveCount(0);
      return;
    }

    await expect(controls).toBeVisible();
    const prev = controls.getByRole("button", { name: "Previous jobs" });
    const next = controls.getByRole("button", { name: "Next jobs" });
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();

    await next.click();
    await expect(prev).toBeEnabled();
    // Advancing must show a different set of cards, not repaint the same page.
    await expect
      .poll(async () => (await readCards()).join("|"))
      .not.toBe(firstPage.join("|"));
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
    // Two copies of the track are in the DOM at any width — the mobile splash
    // renders one and the desktop landing (hidden by CSS) renders the other.
    // Scope to the visible one rather than letting strict mode fail.
    const track = page.locator(".m-job-carousel-track").filter({ visible: true });
    await expect(track).toHaveCount(1);
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
