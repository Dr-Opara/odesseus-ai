import { test, expect } from "@playwright/test";

/**
 * Employer portal (Phase 5).
 *
 * Employer accounts are created on desktop/web only, so the phone flow is
 * Business Login -> employer portal. These tests cover what can be proven
 * without a provisioned employer organization: the auth boundary, the
 * desktop-only sign-up rule, the phone entry points, and the two things that
 * must never appear in an employer session (Odesseus Live, and any employer
 * surface that would show a fabricated hiring figure).
 *
 * Signed-out coverage runs at all three QA phone widths. Signed-in rendering is
 * covered by `tests/unit/employer-service.test.ts` against the persisted
 * record shapes, because an employer organization cannot be created from the
 * UI until org provisioning ships (see `docs/phase-5-employer-blockers.md`).
 */

const mobileViewports = [
  { name: "375x812", width: 375, height: 812 },
  { name: "390x844", width: 390, height: 844 },
  { name: "393x852", width: 393, height: 852 },
  { name: "430x932", width: 430, height: 932 },
] as const;

const PORTAL_ROUTES = [
  "/employers/dashboard",
  "/employers/dashboard/jobs",
  "/employers/dashboard/team",
  "/employers/dashboard/billing",
] as const;

test.describe("employer portal auth boundary", () => {
  for (const route of PORTAL_ROUTES) {
    test(`redirects a signed-out visitor from ${route}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/);
    });
  }

  test("the auth proxy does not treat the employer portal as public", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/employers/dashboard");
    // It must not land back on the employer sign-in page either, because the
    // proxy's public list decides this, and the portal is deliberately absent
    // from it.
    expect(page.url()).toContain("/login");
    expect(page.url()).not.toContain("/employers/dashboard");
  });
});

test.describe("employer sign-up is desktop-only", () => {
  test("desktop shows the employer sign-up form", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/employers/signup");

    await expect(page.getByRole("heading", { name: "Create your employer account" })).toBeVisible();
    await expect(page.getByLabel("Company name")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Account" })).toBeVisible();
  });

  for (const vp of mobileViewports) {
    test(`${vp.name}: no employer sign-up form, Business Login instead`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/employers/signup");

      expect(page.url()).toContain("/employers/signup");

      // No company-email or password field is reachable on a phone.
      await expect(page.getByLabel("Company name").filter({ visible: true })).toHaveCount(0);
      await expect(page.getByLabel("Company email").filter({ visible: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Create Account" }).filter({ visible: true })).toHaveCount(0);

      // The phone flow is Business Login.
      const login = page.getByRole("link", { name: "Business Login" });
      await expect(login).toBeVisible();
      await login.click();
      await expect(page).toHaveURL(/\/employers\/login/);
    });
  }
});

test.describe("employer phone entry point", () => {
  for (const vp of mobileViewports) {
    test(`${vp.name}: the mobile splash Business Login action opens employer sign-in`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");

      const businessLogin = page.getByRole("link", { name: /Business Login/ });
      await expect(businessLogin).toBeVisible();
      await businessLogin.click();
      await expect(page).toHaveURL(/\/employers\/login/);
    });

    test(`${vp.name}: employer sign-in offers the form and no sign-up link`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/employers/login");

      await expect(page.getByRole("heading", { name: "Business Login" })).toBeVisible();
      await expect(page.getByLabel("Company email").filter({ visible: true })).toBeVisible();
      await expect(page.getByLabel("Password").filter({ visible: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign In" }).filter({ visible: true })).toBeVisible();

      // The desktop-only "create an employer account" link must stay hidden.
      await expect(
        page.getByRole("link", { name: "Create an employer account" }).filter({ visible: true })
      ).toHaveCount(0);

      // A way back out of the portal, for a shared device.
      await expect(page.getByRole("link", { name: "Back to Odesseus" })).toBeVisible();
    });
  }
});

test.describe("employer pricing surface", () => {
  test("desktop leads each plan with Start Hiring", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/employers/pricing");

    const startHiring = page.getByRole("link", { name: "Start Hiring" });
    await expect(startHiring.filter({ visible: true }).first()).toBeVisible();
    await expect(startHiring.filter({ visible: true }).first()).toHaveAttribute(
      "href",
      "/employers/signup"
    );
  });

  for (const vp of mobileViewports) {
    test(`${vp.name}: the call to action is Business Login, not Start Hiring`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/employers/pricing");

      await expect(page.getByRole("link", { name: "Start Hiring" }).filter({ visible: true })).toHaveCount(0);
      const businessLogin = page.getByRole("link", { name: "Business Login" }).filter({ visible: true });
      await expect(businessLogin.first()).toHaveAttribute("href", "/employers/login");
    });
  }

  test("shows the approved employer terms on every width", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/employers/pricing");

    for (const figure of ["$79", "$149", "$299", "$29", "$49", "$129", "$20"]) {
      await expect(page.getByText(figure).filter({ visible: true }).first()).toBeVisible();
    }
    // The retired per-application price has no place on an employer surface.
    await expect(page.getByText("$0.99").filter({ visible: true })).toHaveCount(0);
  });
});

test.describe("no Odesseus Live on employer surfaces", () => {
  const EMPLOYER_PUBLIC_ROUTES = [
    "/employers",
    "/employers/pricing",
    "/employers/login",
    "/employers/signup",
    "/employers/post-job",
  ] as const;

  const LIVE_PRICES = ["$24.99", "$59.99", "$499"];

  for (const route of EMPLOYER_PUBLIC_ROUTES) {
    test(`${route} never mentions or links Live`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      // /employers/post-job redirects a signed-out visitor to sign-up; either
      // landing page is an employer surface, so the assertion holds either way.
      await page.goto(route);

      // One DOM read rather than a locator per figure. A `getByText` substring
      // scan per price is six round-trips whose only possible outcome is zero
      // matches, and the retrying locators were enough to crash a renderer
      // under parallel load ("session closed") rather than report a real
      // failure. Scanning the whole rendered document is also the stronger
      // check: a Live link hidden by CSS on an employer page is still a leak
      // waiting for the next stylesheet change.
      const seen = await page.evaluate((prices) => {
        const anchors = Array.from(document.querySelectorAll("a[href]")).map((a) =>
          a.getAttribute("href") ?? ""
        );
        return {
          liveText: /odesseus\s*live/i.test(document.body.innerText),
          livePrices: prices.filter((price) => document.body.innerText.includes(price)),
          liveHrefs: anchors.filter((href) => href === "/live" || href.startsWith("/live?")),
          interviewHrefs: anchors.filter((href) => href.includes("/interviews")),
        };
      }, LIVE_PRICES);

      expect(seen).toEqual({ liveText: false, livePrices: [], liveHrefs: [], interviewHrefs: [] });
    });
  }
});
