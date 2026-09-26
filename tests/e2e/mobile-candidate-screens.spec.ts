import { test, expect } from "@playwright/test";

// Phase 5 — mobile rendering boundary. These tests run against the real
// routes with a phone viewport (the playwright "mobile-chrome" Pixel 7
// project), asserting that the mobile presentation renders instead of the
// desktop layout, and that the auth boundary still holds at phone widths.
// They need no OpenAI/Stripe/Browserbase credentials, only a running dev
// server backed by local Supabase (same requirement as the existing e2e
// specs in this directory).

test.describe("mobile landing splash (screen 00)", () => {
  test("phone viewport renders the splash with the approved live-job stack", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator(".m-splash")).toBeVisible();
    // The desktop marketing landing must not leak in under the phone width.
    await expect(page.locator(".m-splash").getByRole("link", { name: /Get Started/i })).toBeVisible();
    // The Figma-approved job stack shows real company names as illustrative
    // live-job examples (product decision, not a data claim about real
    // openings) — verify the stack renders as designed.
    await expect(page.locator(".m-splash").getByText("Microsoft", { exact: false })).toBeVisible();
    await expect(page.locator(".m-splash").getByText("NVIDIA", { exact: false })).toBeVisible();
    await expect(page.locator(".m-splash").getByText("Amazon", { exact: false })).toBeVisible();
    await expect(page.locator(".m-splash").getByText("Google", { exact: false })).toBeVisible();
  });

  test("desktop viewport renders the real marketing landing, not the splash", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    // The splash shell is mobile-only.
    await expect(page.locator(".m-splash")).toBeHidden();
    // Desktop hero headline is present and instead a screen-reader-only h1.
    await page.getByRole("heading", { name: "Discover Your Dream Job with Odesseus.ai" }).waitFor();
    await expect(page.getByRole("heading", { name: "Discover Your Dream Job with Odesseus.ai" })).toBeVisible();
  });
});

test.describe("mobile splash CTA area (screen 00)", () => {
  const viewports = [
    { name: "390x844", width: 390, height: 844 },
    { name: "393x852", width: 393, height: 852 },
    { name: "430x932", width: 430, height: 932 },
  ] as const;

  for (const vp of viewports) {
    test(`${vp.name}: pills sit side-by-side with a full-width See Pricing button below`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      const splash = page.locator(".m-splash");

      const getStarted = splash.getByRole("link", { name: /Get Started/i });
      const businessLogin = splash.getByRole("link", { name: "Business Login" });
      const seePricing = splash.getByRole("link", { name: /See Pricing/i });

      await expect(getStarted).toBeVisible();
      await expect(businessLogin).toBeVisible();
      await expect(seePricing).toBeVisible();
      await expect(getStarted).toHaveAttribute("href", "/signup");
      await expect(businessLogin).toHaveAttribute("href", "/employers/login");
      await expect(seePricing).toHaveAttribute("href", "/pricing");

      const a = await splash.locator(".m-splash-cta").nth(0).boundingBox();
      const b = await splash.locator(".m-splash-cta").nth(1).boundingBox();
      const w = await splash.locator(".m-splash-cta-wide").boundingBox();
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(w).not.toBeNull();
      // Both pills share one row on the ~390px canvas and stay touch-friendly.
      expect(Math.abs(a!.y - b!.y)).toBeLessThanOrEqual(2);
      expect(a!.height).toBeGreaterThanOrEqual(48);
      // See Pricing sits on its own row below the pills and spans the column.
      expect(w!.y).toBeGreaterThan(b!.y + b!.height - 1);
      expect(w!.width).toBeGreaterThan(200);
    });

    test(`${vp.name}: splash CTAs route to signup, employer login, and pricing`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      const splash = page.locator(".m-splash");

      await splash.getByRole("link", { name: /Get Started/i }).click();
      await expect(page).toHaveURL(/\/signup$/);
      await page.goto("/");
      await splash.getByRole("link", { name: "Business Login" }).click();
      await expect(page).toHaveURL(/\/employers\/login$/);
      await page.goto("/");
      await splash.getByRole("link", { name: /See Pricing/i }).click();
      await expect(page).toHaveURL(/\/pricing$/);
    });

    // Full Screen 00 element audit at each QA width. Everything the approved
    // Figma node 32:2 specifies has to be present, unclipped, and inside the
    // viewport — the failure mode this catches is a card or CTA pushed off
    // screen by a font or width change, which a single-width test misses.
    test(`${vp.name}: every approved Screen 00 element is present and inside the canvas`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      const splash = page.locator(".m-splash");

      // The whole mobile experience is on one non-scrolling canvas.
      await expect(splash).toBeVisible();
      const overflowX = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflowX, "the splash must never scroll horizontally").toBeLessThanOrEqual(0);

      // 1. Decorative orbs — two top-left, two bottom-right, behind content.
      const orbs = splash.locator(".m-splash-orb");
      await expect(orbs).toHaveCount(4);
      for (const cls of ["tl-a", "tl-b", "br-a", "br-b"]) {
        const orb = splash.locator(`.m-splash-orb-${cls}`);
        await expect(orb).toHaveCount(1);
        const box = (await orb.boundingBox())!;
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
      }

      // 2. Job card stack — three receding company cards plus the foreground
      //    Microsoft card, each wider than the one behind it.
      const stack = splash.locator(".m-stack-card");
      await expect(stack).toHaveCount(4);
      const widths: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        widths.push((await stack.nth(i).boundingBox())!.width);
      }
      for (let i = 1; i < widths.length; i += 1) {
        expect(widths[i], "the stack widens toward the foreground card").toBeGreaterThan(widths[i - 1]);
      }
      for (const company of ["NVIDIA", "Amazon", "Google", "Microsoft"]) {
        await expect(stack.getByText(company, { exact: false })).toBeVisible();
      }

      // 3. Microsoft card — logo, role, salary, and both in-card actions.
      const ms = splash.locator(".m-stack-ms");
      await expect(ms).toHaveCount(1);
      await expect(ms.locator(".m-stack-ms-logo")).toBeVisible();
      await expect(ms.getByRole("heading")).toContainText("GenAI Security");
      await expect(ms.getByText(/\$247K/)).toBeVisible();
      await expect(ms.getByText(/See Details/)).toBeVisible();
      await expect(ms.getByText(/Next Match/)).toBeVisible();
      const msBox = (await ms.boundingBox())!;
      const splashBox = (await splash.boundingBox())!;
      expect(msBox.x).toBeGreaterThanOrEqual(splashBox.x);
      expect(msBox.x + msBox.width).toBeLessThanOrEqual(splashBox.x + splashBox.width + 1);

      // 4. Headline with its two accent spans.
      const headline = splash.locator(".m-splash-card > h1");
      await expect(headline).toBeVisible();
      await expect(headline).toHaveText(/Discover Your\s*Dream Job\s*with\s*Odesseus\.ai/);
      await expect(headline.locator("em")).toHaveCount(2);
      await expect(headline.getByText("Dream Job")).toBeVisible();
      await expect(headline.getByText("Odesseus.ai")).toBeVisible();

      // 5. Pagination — four dots with the first one active.
      const dots = splash.locator(".m-dot");
      await expect(dots).toHaveCount(4);
      await expect(splash.locator(".m-dot.is-active")).toHaveCount(1);
      expect((await splash.locator(".m-dot.is-active").boundingBox())!.width).toBeGreaterThan(
        (await dots.nth(1).boundingBox())!.width,
      );

      // 6. Metrics — the four-up marketing figures.
      const stats = splash.locator(".m-splash-stats span");
      await expect(stats).toHaveCount(4);
      for (const [value, label] of [
        ["500K+", "Applicants"],
        ["100K+", "Hires"],
        ["10+", "Countries"],
        ["95%", "Satisfaction"],
      ] as const) {
        await expect(splash.locator(".m-splash-stats")).toContainText(value);
        await expect(splash.locator(".m-splash-stats")).toContainText(label);
      }

      // 7. Footer.
      const footer = splash.locator(".m-splash-footer");
      await expect(footer).toBeVisible();
      await expect(footer.getByText("Odesseus.ai")).toBeVisible();
      const footerBox = (await footer.boundingBox())!;
      expect(footerBox.y).toBeGreaterThan((await stats.nth(3).boundingBox())!.y);

      // 8. No public navigation chrome duplicates the splash actions.
      await expect(page.locator(".figma-nav-toggle")).toHaveCount(0);
      await expect(page.locator(".figma-nav-mobile")).toHaveCount(0);
    });

    // Spacing: the approved artboard insets the dark card by 36px on the
    // sides and 28px on top, with 26px of card padding, at every QA width.
    test(`${vp.name}: canvas insets and card padding match the approved artboard`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");

      const metrics = await page.evaluate(() => {
        const rect = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        };
        const card = document.querySelector(".m-splash-card")!;
        return {
          viewport: { w: window.innerWidth, h: window.innerHeight },
          splash: rect(".m-splash"),
          card: rect(".m-splash-card"),
          cardPadLeft: parseFloat(getComputedStyle(card).paddingLeft),
          headline: rect(".m-splash-card > h1"),
        };
      });

      expect(metrics.splash).not.toBeNull();
      expect(metrics.card).not.toBeNull();
      // The lavender gutter fills the viewport height — no bare strip below.
      expect(metrics.splash!.h).toBeGreaterThanOrEqual(metrics.viewport.h);
      // 36px side inset, centred canvas capped at 430px.
      expect(metrics.card!.x).toBeCloseTo(36, 0);
      expect(metrics.viewport.w - (metrics.card!.x + metrics.card!.w)).toBeCloseTo(36, 0);
      // 26px of card padding puts the headline 62px from the canvas edge.
      expect(metrics.cardPadLeft).toBeCloseTo(26, 0);
      expect(metrics.headline!.x).toBeCloseTo(62, 0);
    });
  }
});

test.describe("mobile auth boundary at phone width", () => {
  const protectedRoutes = [
    "/dashboard",
    "/jobs",
    "/applications",
    "/profile",
    "/billing",
    // Phase 5 Batch B: the real wired settings sub-route and the resume
    // review route both re-check the session server-side before rendering.
    "/settings/documents",
    "/resume-tailoring/00000000-0000-0000-0000-000000000000",
    // Phase 5 Batch C: the remaining wired settings sub-routes and the
    // report-job route re-check the session server-side before rendering.
    "/settings/security",
    "/settings/notifications",
    "/settings/job-preferences",
    "/settings/language-region",
    "/settings/appearance",
    "/settings/referrals",
    "/report-job",
  ] as const;

  for (const route of protectedRoutes) {
    test(`redirects an unauthenticated visitor from ${route} to /login at phone width`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/);
    });
  }

  test("login page renders the sign-in form at phone width", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
  });
});

test.describe("public mobile pages at phone width (signed out)", () => {
  const publicRoutes = [
    "/pricing",
    "/about",
    "/faq",
    "/support",
    "/legal",
    "/terms",
    "/privacy",
    "/accessibility",
    "/licenses",
    "/employers",
    "/employers/pricing",
    "/employers/login",
    "/signup",
    "/partners",
    "/how-it-works",
  ] as const;

  for (const route of publicRoutes) {
    test(`${route} stays public and never shows the authenticated bottom nav`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(route);
      // No redirect to the candidate login: the signed-out visitor lands on
      // the public route itself.
      expect(new URL(page.url()).pathname).toBe(route);
      await expect(page.locator("body")).toBeVisible();
      await expect(page.locator(".m-bottom-nav")).toHaveCount(0);
      await expect(page.locator(".mobile-app-bottom-nav")).toHaveCount(0);
    });
  }
});