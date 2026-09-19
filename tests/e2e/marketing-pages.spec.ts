import { test, expect } from "@playwright/test";

// Exercises the public marketing site's architecture: the shared nav/footer,
// the five dedicated product/company routes that replaced homepage anchors,
// and the copy constraints from the marketing architecture spec (no "calmer"
// language, no Kernor branding, no unsupported compatibility/partnership
// claims). Requires no auth/backend credentials — these are all public pages.

const pages = [
  { path: "/", title: /Odysseus/, heading: "Your next move, handled." },
  { path: "/how-it-works", title: /How Odysseus Works/, heading: "The complete Odysseus lifecycle." },
  { path: "/apply", title: /Apply with Odysseus/, heading: "Apply anywhere your next opportunity lives." },
  { path: "/live", title: /Odysseus Live/, heading: "Go into your interview with your entire application behind you." },
  { path: "/pricing", title: /Pricing/, heading: "No subscription. Pay when Odysseus works for you." },
  { path: "/about", title: /About/, heading: "The job search shouldn't be a second full-time job." },
];

test.describe("marketing page titles and headings", () => {
  for (const { path, title, heading } of pages) {
    test(`${path} has the expected title and heading`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveTitle(title);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    });
  }
});

test.describe("shared marketing navigation", () => {
  // The desktop nav links are hidden below 680px (replaced by the mobile
  // menu, covered separately below) — force a desktop viewport here so
  // this block behaves the same under both Playwright projects.
  test.use({ viewport: { width: 1280, height: 800 } });

  const navLinks = [
    ["How It Works", "/how-it-works"],
    ["Apply", "/apply"],
    ["Live", "/live"],
    ["Pricing", "/pricing"],
    ["About", "/about"],
  ] as const;

  for (const { path } of pages) {
    test(`${path} renders the shared nav with real routes (no anchor hrefs)`, async ({ page }) => {
      await page.goto(path);
      const nav = page.locator(".marketing-nav-links");
      for (const [label, href] of navLinks) {
        const link = nav.getByRole("link", { name: label });
        await expect(link).toBeVisible();
        await expect(link).toHaveAttribute("href", href);
      }
    });
  }

  test("clicking a nav link navigates to the dedicated page", async ({ page }) => {
    await page.goto("/");
    await page.locator(".marketing-nav-links").getByRole("link", { name: "Pricing" }).click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.getByRole("heading", { name: "No subscription. Pay when Odysseus works for you." })).toBeVisible();
  });
});

test.describe("mobile navigation menu", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("opens and contains every nav link plus account actions", async ({ page }) => {
    await page.goto("/");
    await page.locator(".marketing-nav-toggle").click();

    const panel = page.locator(".marketing-nav-mobile-panel");
    await expect(panel).toBeVisible();
    for (const label of ["How It Works", "Apply", "Live", "Pricing", "About"]) {
      await expect(panel.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(panel.getByRole("link", { name: "Sign In" })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Get Started" })).toBeVisible();
  });

  test("navigates to a dedicated page and closes the menu", async ({ page }) => {
    await page.goto("/");
    await page.locator(".marketing-nav-toggle").click();
    await page.locator(".marketing-nav-mobile-panel").getByRole("link", { name: "Apply" }).click();
    await expect(page).toHaveURL(/\/apply$/);
    await expect(page.locator(".marketing-nav-mobile-panel")).toHaveCount(0);
  });
});

test.describe("shared marketing footer", () => {
  for (const { path } of pages) {
    test(`${path} renders the Product/Company/Account footer`, async ({ page }) => {
      await page.goto(path);
      const footer = page.locator(".marketing-footer");
      await expect(footer.getByText("Product")).toBeVisible();
      await expect(footer.getByText("Company")).toBeVisible();
      await expect(footer.getByText("Account")).toBeVisible();
      await expect(footer.getByRole("link", { name: "How It Works" })).toBeVisible();
      await expect(footer.getByRole("link", { name: "Apply" })).toBeVisible();
      await expect(footer.getByRole("link", { name: "Live" })).toBeVisible();
      await expect(footer.getByRole("link", { name: "Pricing" })).toBeVisible();
      await expect(footer.getByRole("link", { name: "About" })).toBeVisible();
      await expect(footer.getByRole("link", { name: "Sign In" })).toBeVisible();
      await expect(footer.getByRole("link", { name: "Get Started" })).toBeVisible();
    });
  }
});

test.describe("pricing figures", () => {
  test("/apply prominently shows $0.99 and the successful-submission rule", async ({ page }) => {
    await page.goto("/apply");
    await expect(page.getByText("$0.99").first()).toBeVisible();
    await expect(page.getByText("$0.99 only after successful submission")).toBeVisible();
  });

  test("/live prominently shows $24.99", async ({ page }) => {
    await page.goto("/live");
    await expect(page.getByText("$24.99").first()).toBeVisible();
  });

  test("/pricing shows both products and the free section", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText("$0.99").first()).toBeVisible();
    await expect(page.getByText("$24.99").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Free with Odysseus" })).toBeVisible();
  });
});

test.describe("pricing bundles", () => {
  test("/pricing shows application credit packs with bundle prices", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByRole("heading", { name: "Save with Application Credits" })).toBeVisible();
    await expect(page.getByText("1 application credit = 1 successfully submitted application.")).toBeVisible();
    await expect(page.getByText("$20")).toBeVisible();
    await expect(page.getByText("$35")).toBeVisible();
    await expect(page.getByText("$59", { exact: true })).toBeVisible();
  });

  test("/pricing shows the interview pass 3-pack and annual plan", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByRole("heading", { name: "Interview Passes" })).toBeVisible();
    await expect(page.getByText("$59.99")).toBeVisible();
    await expect(page.getByText("$499")).toBeVisible();
    await expect(page.getByText("Odysseus Live Annual").first()).toBeVisible();
    await expect(page.getByText(/subject to fair use/i).first()).toBeVisible();
  });

  test("/pricing sections appear in the required order", async ({ page }) => {
    await page.goto("/pricing");
    // .innerText reflects the rendered text-transform: uppercase on the
    // eyebrow labels, so compare case-insensitively.
    const headings = await page.locator(".pricing-section-heading").allInnerTexts();
    const joined = headings.join(" | ").toLowerCase();
    const payIdx = joined.indexOf("pay as you go");
    const creditsIdx = joined.indexOf("save with application credits");
    const passesIdx = joined.indexOf("interview passes");
    const freeIdx = joined.indexOf("free with odysseus");
    expect(payIdx).toBeGreaterThanOrEqual(0);
    expect(creditsIdx).toBeGreaterThan(payIdx);
    expect(passesIdx).toBeGreaterThan(creditsIdx);
    expect(freeIdx).toBeGreaterThan(passesIdx);
  });
});

test.describe("Live platform compatibility section", () => {
  const compatiblePlatforms = [
    "Zoom",
    "Microsoft Teams",
    "Google Meet",
    "Webex",
    "Lark",
    "Amazon Chime",
    "CoderPad",
    "HackerRank",
  ];

  test("/live shows the platform-compatibility section between During and After", async ({ page }) => {
    await page.goto("/live");
    await expect(page.getByRole("heading", { name: "Works with the tools your interviews already use" })).toBeVisible();
    await expect(page.getByText("Odysseus Live is designed to work alongside supported video interview, technical interview, and assessment platforms.")).toBeVisible();

    for (const platform of compatiblePlatforms) {
      await expect(page.getByText(platform, { exact: true })).toBeVisible();
    }
    await expect(page.getByText("Supported platform").first()).toBeVisible();
  });

  test("/live platform section uses neutral status language and no partnership claims", async ({ page }) => {
    await page.goto("/live");
    const text = (await page.locator(".platform-compat-scroll").innerText()).toLowerCase();
    expect(text).not.toContain("verified");
    expect(text).not.toContain("invisible");
    expect(text).not.toContain("undetectable");
    expect(text).not.toContain("stealth");
    expect(text).not.toContain("bypass");
  });

  test("/live includes the compatibility caveat and non-participant framing", async ({ page }) => {
    await page.goto("/live");
    await expect(page.getByText(/without joining the meeting as another participant/i)).toBeVisible();
    await expect(page.getByText(/Platform compatibility may vary by browser, operating system/i)).toBeVisible();
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
      expect(text).not.toContain("partner");
      expect(text).not.toContain("endorse");
      expect(text).not.toContain("universal compatibility");
    });
  }

  test("/apply and homepage scope cross-platform coverage to supported platforms", async ({ page }) => {
    for (const path of ["/", "/apply"]) {
      await page.goto(path);
      await expect(page.getByText(/supported job boards/i).first()).toBeVisible();
    }
  });
});
