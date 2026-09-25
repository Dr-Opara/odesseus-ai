import { test, expect } from "@playwright/test";

// /pricing is a public, mobile-friendly page split into two audience tabs
// (Applicants | Business). Neither tab requires login. Coverage here runs the
// full contract at all three QA phone widths and checks the desktop pricing
// surface still renders unchanged (no tabs there).

const mobileViewports = [
  { name: "390x844", width: 390, height: 844 },
  { name: "393x852", width: 393, height: 852 },
  { name: "430x932", width: 430, height: 932 },
] as const;

test.describe("mobile /pricing audience tabs (signed out)", () => {
  for (const vp of mobileViewports) {
    test(`${vp.name}: Applicants tab renders the candidate contract without login`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/pricing");

      // Public: no redirect, mobile surface, no authenticated bottom nav.
      expect(page.url()).not.toContain("/login");
      await expect(page.locator(".m-screen")).toBeVisible();
      await expect(page.locator(".m-bottom-nav")).toHaveCount(0);
      await expect(page.locator(".mobile-app-bottom-nav")).toHaveCount(0);

      // Applicants is the default tab.
      const applicants = page.getByRole("tab", { name: "Applicants" });
      const business = page.getByRole("tab", { name: "Business" });
      await expect(applicants).toBeVisible();
      await expect(applicants).toHaveAttribute("aria-selected", "true");
      await expect(business).toBeVisible();
      await expect(business).toHaveAttribute("aria-selected", "false");

      // Standard/Smart applies, wallet top-ups, free prep.
      for (const figure of ["$0.49", "$1.99", "$10", "$20", "$50"]) {
        await expect(page.getByText(figure).filter({ visible: true }).first()).toBeVisible();
      }
      await expect(page.getByText(/Interview preparation · Free/i)).toBeVisible();
      // Live plans with an explicit desktop/web-only note (no mobile Live flow).
      for (const figure of ["$24.99", "$59.99", "$499"]) {
        await expect(page.getByText(figure).filter({ visible: true }).first()).toBeVisible();
      }
      await expect(page.getByText(/Odesseus Live runs in a desktop/i)).toBeVisible();
    });

    test(`${vp.name}: Business tab shows the employer contract and hides applicants`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/pricing");

      await page.getByRole("tab", { name: "Business" }).click();
      await expect(page.getByRole("tab", { name: "Business" })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tab", { name: "Applicants" })).toHaveAttribute("aria-selected", "false");

      // Employer plans, promotions, recruiter seat.
      for (const figure of ["$79", "$149", "$299"]) {
        await expect(page.getByText(figure).filter({ visible: true }).first()).toBeVisible();
      }
      await expect(page.getByText(/3 active jobs/i).filter({ visible: true }).first()).toBeVisible();
      await expect(page.getByText(/10 active jobs/i).filter({ visible: true }).first()).toBeVisible();
      await expect(page.getByText(/25 active jobs/i).filter({ visible: true }).first()).toBeVisible();
      for (const figure of ["$29", "$49", "$129"]) {
        await expect(page.getByText(figure).filter({ visible: true }).first()).toBeVisible();
      }
      await expect(page.getByText(/Recruiter seat · \$20\/month/i)).toBeVisible();

      // Applicant figures leave the visible tab.
      await expect(page.getByText("$0.49").filter({ visible: true })).toHaveCount(0);

      // Switching back restores the applicants list.
      await page.getByRole("tab", { name: "Applicants" }).click();
      await expect(page.getByText("$0.49").filter({ visible: true }).first()).toBeVisible();
    });
  }
});

test.describe("desktop /pricing unchanged", () => {
  test("keeps the desktop layout with the full contract and no audience tabs", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/pricing");
    await expect(
      page.getByRole("heading", { name: "Flexible pricing for candidates and employers." }),
    ).toBeVisible();
    // The tab strip is mobile-only and invisible at desktop width.
    await expect(page.getByRole("tablist")).toHaveCount(0);
    for (const figure of ["$0.49", "$1.99", "$10", "$20", "$50", "$79", "$149", "$299", "$29", "$49", "$129", "$24.99", "$59.99", "$499"]) {
      await expect(page.getByText(figure).filter({ visible: true }).first()).toBeVisible();
    }
  });
});