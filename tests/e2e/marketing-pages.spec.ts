import { test, expect } from "@playwright/test";

// Exercises the public marketing site's architecture: the shared nav/footer,
// the dedicated product/company routes, and the copy constraints from the
// marketing architecture spec (no "calmer" language, no Kernor branding, no
// unsupported compatibility/partnership claims). Requires no auth/backend
// credentials — these are all public pages.

const pages = [
  // The homepage hero is a visual job-search dashboard showcase with no
  // visible headline on small screens; the H1 is present for accessibility/SEO.
  { path: "/", heading: "Discover Your Dream Job with Odesseus.ai", visible: false },
  { path: "/how-it-works", heading: "A smarter path from search to interview." },
  { path: "/apply", heading: "Apply anywhere your next opportunity lives." },
  // /live redirects to /agents as part of the three-core-agent simplification.
  { path: "/agents", heading: "Three agents. One job-to-interview workflow." },
  { path: "/live", heading: "Three agents. One job-to-interview workflow." },
  { path: "/pricing", heading: "Flexible pricing for candidates and employers.", mobileHeading: "Pricing" },
  { path: "/about", heading: "Career technology built around real workflows.", mobileHeading: "About Odesseus.ai" },
];

test.describe("marketing page titles and headings", () => {
  for (const { path, heading, mobileHeading, visible = true } of pages) {
    test(`${path} has a title tied to Odesseus and the expected heading`, async ({ page, isMobile }) => {
      await page.goto(path);
      await expect(page).toHaveTitle(/Odesseus/);
      const expectedHeading = isMobile && mobileHeading ? mobileHeading : heading;
      const headingLocator = page.getByRole("heading", { name: expectedHeading, level: 1 });
      if (visible) {
        await expect(headingLocator).toBeVisible();
      } else {
        await expect(headingLocator).toBeAttached();
      }
    });
  }
});

test.describe("shared marketing navigation", () => {
  // The desktop nav links are hidden below 680px (replaced by the mobile
  // menu, covered separately below) — force a desktop viewport here so
  // this block behaves the same under both Playwright projects.
  test.use({ viewport: { width: 1280, height: 800 } });

  const navLinks = [
    ["Job Seekers", "/how-it-works"],
    ["Employers", "/employers"],
    ["Pricing", "/pricing"],
    ["About", "/about"],
  ] as const;

  for (const { path } of pages) {
    test(`${path} renders the shared nav with real routes (no anchor hrefs)`, async ({ page }) => {
      await page.goto(path);
      const nav = page.locator(".figma-nav-links");
      for (const [label, href] of navLinks) {
        const link = nav.getByRole("link", { name: label });
        await expect(link).toBeVisible();
        await expect(link).toHaveAttribute("href", href);
      }
    });
  }

  test("clicking a nav link navigates to the dedicated page", async ({ page }) => {
    await page.goto("/");
    await page.locator(".figma-nav-links").getByRole("link", { name: "Pricing" }).click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.getByRole("heading", { name: "Flexible pricing for candidates and employers." })).toBeVisible();
  });
});

test.describe("mobile navigation menu", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("opens and contains every nav link plus account actions", async ({ page }) => {
    // /apply keeps the shared marketing nav visible at phone width (the
    // homepage becomes the Screen 00 splash), so it is used to drive the menu.
    await page.goto("/apply");
    await page.locator(".figma-nav-toggle").click();

    const panel = page.locator(".figma-nav-mobile");
    await expect(panel).toBeVisible();
    for (const label of ["Job Seekers", "Employers", "Pricing", "About", "FAQ"]) {
      await expect(panel.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(panel.getByRole("link", { name: "Sign In" })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Get Started" })).toBeVisible();
  });

  test("navigates to a dedicated page and closes the menu", async ({ page }) => {
    await page.goto("/apply");
    await page.locator(".figma-nav-toggle").click();
    await page.locator(".figma-nav-mobile").getByRole("link", { name: "Pricing" }).click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.locator(".figma-nav-mobile")).toHaveCount(0);
  });
});

test.describe("shared marketing footer", () => {
  // Mobile pages own their own compact footers, so this shared-footer
  // architecture check runs against the desktop layout at all times.
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const { path } of pages) {
    test(`${path} renders the Job Seekers/Employers/Company footer`, async ({ page }) => {
      await page.goto(path);
      const footer = page.locator(".figma-footer");
      await expect(footer.getByText("Job Seekers")).toBeVisible();
      await expect(footer.getByText("Employers", { exact: true })).toBeVisible();
      await expect(footer.getByText("Company")).toBeVisible();
      await expect(footer.getByRole("link", { name: "How it works" })).toBeVisible();
      await expect(footer.getByRole("link", { name: "Pricing", exact: true })).toBeVisible();
      await expect(footer.getByRole("link", { name: "Agents" })).toBeVisible();
      await expect(footer.getByRole("link", { name: "About" })).toBeVisible();
      await expect(footer.getByRole("link", { name: "Partner Program" })).toHaveAttribute("href", "/partners");
    });
  }
});

test.describe("pricing figures", () => {
  test("/apply prominently shows Standard $0.49 and Smart $1.99 with the wallet success rule", async ({ page }) => {
    await page.goto("/apply");
    await expect(page.getByText("$0.49").filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText("$1.99").filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText("Charged from your wallet only after successful submission")).toBeVisible();
  });

  test("/pricing shows the apply tiers and wallet top-ups", async ({ page }) => {
    await page.goto("/pricing");
    for (const figure of ["$0.49", "$1.99", "$10", "$20", "$50"]) {
      await expect(page.getByText(figure).filter({ visible: true }).first()).toBeVisible();
    }
  });

  test("/pricing does not advertise Odesseus Live (private to signed-in applicants)", async ({ page }) => {
    await page.goto("/pricing");
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("odesseus live");
    expect(body).not.toContain("$24.99");
    expect(body).not.toContain("$59.99");
    expect(body).not.toContain("$499");
  });
});

test.describe("wallet and pay-as-you-go pricing", () => {
  test("/pricing shows wallet top-ups in place of old application credit packs", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText("Wallet top-up").filter({ visible: true }).first()).toBeVisible();
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("$0.99");
    expect(body).not.toContain("credit pack");
    expect(body).not.toContain("25 credits");
  });

  test("/pricing sections appear in the required order (desktop)", async ({ page, isMobile }) => {
    test.skip(isMobile, "Section order uses the desktop pricing surface");
    await page.goto("/pricing");
    // .innerText reflects the rendered text-transform: uppercase on the
    // eyebrow labels, so compare case-insensitively.
    const headings = await page.locator(".figma-eyebrow").allInnerTexts();
    const joined = headings.join(" | ").toLowerCase();
    let previousIndex = -1;
    for (const expected of ["candidate", "employer", "promotions", "recruiter"]) {
      const index = joined.indexOf(expected);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
  });
});

test.describe("Odesseus Agents page (/live redirect target)", () => {
  test("/live redirects to the agents page", async ({ page }) => {
    await page.goto("/live");
    await expect(page).toHaveURL(/\/agents/);
    await expect(page.getByRole("heading", { name: "Three agents. One job-to-interview workflow." })).toBeVisible();
  });

  test("agents page uses neutral status language and no stealth or partnership claims", async ({ page }) => {
    await page.goto("/agents");
    const text = (await page.locator("body").innerText()).toLowerCase();
    expect(text).not.toContain("stealth");
    expect(text).not.toContain("invisible");
    expect(text).not.toContain("undetectable");
    expect(text).not.toContain("bypass");
    expect(text).not.toContain("official partner of");
  });
});

test.describe("marketing copy constraints", () => {
  for (const { path } of pages) {
    test(`${path} contains no "calmer"/"calm" language, Kernor branding, or unsupported claims`, async ({ page }) => {
      await page.goto(path);
      const text = (await page.locator("body").innerText()).toLowerCase();

      expect(text).not.toContain("calmer");
      expect(text).not.toMatch(/\bcalm\b/);
      expect(text).not.toContain("kernor");
      expect(text).not.toContain("trusted by");
      expect(text).not.toContain("endorsed by");
      expect(text).not.toContain("official partner of");
      expect(text).not.toContain("universal compatibility");
    });
  }

  test("/apply scopes cross-platform coverage to supported platforms", async ({ page }) => {
    await page.goto("/apply");
    await expect(page.getByText(/supported job boards/i).first()).toBeVisible();
  });
});


test.describe("Partner Program public experience", () => {
  test("/partners explains the creator program without fixed commission claims", async ({ page }) => {
    await page.goto("/partners");
    await expect(page).toHaveTitle(/Partner Program/);
    await expect(page.getByRole("heading", { name: "Partner with Odesseus." })).toBeVisible();
    await expect(page.getByText("Instagram", { exact: true })).toBeVisible();
    await expect(page.getByText("Facebook", { exact: true })).toBeVisible();
    await expect(page.getByText("TikTok", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Apply to partner" })).toHaveAttribute("href", "/partners/apply");
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("guaranteed commission");
    expect(body).not.toContain("official partner of");
  });

  test("/partners/apply renders creator application fields", async ({ page }) => {
    await page.goto("/partners/apply");
    await expect(page.getByRole("heading", { name: "Tell us about you and your audience." })).toBeVisible();
    await expect(page.getByLabel("Full name")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByText("Instagram", { exact: true }).first()).toBeVisible();
  });

  test("/partners/terms renders disclosure and commission eligibility rules", async ({ page }) => {
    await page.goto("/partners/terms");
    await expect(page.getByRole("heading", { name: "Clear expectations for Odesseus partners." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Disclosure" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Commission eligibility" })).toBeVisible();
  });
});