import { test, expect } from "@playwright/test";

// Phase 5 — mobile rendering boundary. These tests run against the real
// routes with a phone viewport (the playwright "mobile-chrome" Pixel 7
// project), asserting that the mobile presentation renders instead of the
// desktop layout, and that the auth boundary still holds at phone widths.
// They need no OpenAI/Stripe/Browserbase credentials, only a running dev
// server backed by local Supabase (same requirement as the existing e2e
// specs in this directory).

// The mobile landing and the desktop landing are two presentations of one
// `HomepageBody` (src/components/homepage-body.tsx). A previous Screen 00
// splash was a separate hardcoded design; it was removed when the homepage was
// rebuilt, together with the fabricated figures it carried ($247K salary,
// 500K+/100K+/95% metrics). What is asserted here is the shared design that
// replaced it — real job rows from the live feed, no invented numbers — plus
// the mobile-only chrome that genuinely differs.

test.describe("mobile landing splash (screen 00)", () => {
  test("phone viewport renders the mobile landing with a real job carousel", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const splash = page.locator(".m-oh-screen");
    await expect(splash).toBeVisible();
    // Compact mobile chrome, and it is the only header on a phone.
    await expect(splash.getByRole("link", { name: "Get Started" })).toBeVisible();
    await expect(splash.getByRole("link", { name: "Sign in" })).toBeVisible();
    // Real rows from the feed, not a hardcoded stack of named companies.
    await expect(splash.locator(".m-job-carousel-track .oh-job-card").first()).toBeVisible();
    // The rebuilt design carries no invented figures anywhere.
    const body = await splash.innerText();
    expect(body).not.toMatch(/\$247K|500K\+|100K\+|95%|Applicants|Hires|Satisfaction/);
  });

  test("desktop viewport renders the real marketing landing, not the splash", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    // The splash shell is mobile-only.
    await expect(page.locator(".m-oh-screen")).toBeHidden();
    // Desktop hero headline is present and instead a screen-reader-only h1.
    await page.getByRole("heading", { name: "Discover Your Dream Job with Odesseus.ai" }).waitFor();
    await expect(page.getByRole("heading", { name: "Discover Your Dream Job with Odesseus.ai" })).toBeVisible();
  });
});

test.describe("mobile landing layout (screen 00)", () => {
  const viewports = [
    { name: "375x812", width: 375, height: 812 },
    { name: "390x844", width: 390, height: 844 },
    { name: "393x852", width: 393, height: 852 },
    { name: "430x932", width: 430, height: 932 },
  ] as const;

  for (const vp of viewports) {
    // Full element audit at each QA width, at every element the rebuilt landing
    // specifies. The failure mode this catches is a card or CTA pushed off
    // screen by a font or width change, which a single-width test misses.
    test(`${vp.name}: every approved element is present, unclipped, and inside the canvas`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      const splash = page.locator(".m-oh-screen").filter({ visible: true });

      // 1. The mobile experience is on one canvas and never scrolls sideways.
      await expect(splash).toBeVisible();
      const overflowX = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflowX, "the landing must never scroll horizontally").toBeLessThanOrEqual(0);

      // 2. Mobile nav: wordmark plus the two entry actions, and no desktop nav.
      const nav = splash.locator(".m-oh-nav");
      await expect(nav).toBeVisible();
      const signIn = nav.getByRole("link", { name: "Sign in" });
      const getStarted = nav.getByRole("link", { name: "Get Started" });
      await expect(signIn).toBeVisible();
      await expect(getStarted).toBeVisible();
      await expect(signIn).toHaveAttribute("href", "/signin");
      await expect(getStarted).toHaveAttribute("href", "/signup");

      // Both actions stay tappable: WCAG 2.5.8 puts the minimum target at 24px,
      // and a bare text link measured 18px tall here — the only way to sign in
      // on a phone.
      for (const action of [signIn, getStarted]) {
        expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(24);
      }

      // 3. Hero: eyebrow, headline, and copy.
      await expect(splash.locator(".oh-hero-eyebrow")).toBeVisible();
      const headline = splash.locator(".oh-hero-copy h1");
      await expect(headline).toBeVisible();
      await expect(headline).toContainText("Dream Job");
      await expect(headline.locator("em")).toContainText("Odesseus.ai");

      // 4. Employer CTA, which is the phone route into the employer site.
      const employerCta = splash.getByRole("link", { name: /hiring talent/i });
      await expect(employerCta).toBeVisible();
      await expect(employerCta).toHaveAttribute("href", "/employers");

      // 5. Real job rows, with pagination dots matching them.
      const track = splash.locator(".m-job-carousel-track");
      await expect(track.locator(".oh-job-card").first()).toBeVisible();
      const cards = await track.locator(".oh-job-card").count();
      await expect(splash.locator(".oh-carousel-dots .oh-carousel-dot")).toHaveCount(cards);
      await expect(splash.locator(".oh-carousel-dots .oh-carousel-dot.is-active")).toHaveCount(1);

      // 6. Trust band and capability tiles, with no invented figures.
      await expect(splash.locator(".oh-trust-band")).toBeVisible();
      await expect(splash.locator(".oh-capability-tile").first()).toBeVisible();
      await expect(splash.locator(".oh-logo-strip")).toBeVisible();

      // 7. No public navigation chrome duplicates the splash actions.
      await expect(page.locator(".figma-nav-toggle")).toHaveCount(0);
      await expect(page.locator(".figma-nav-mobile")).toHaveCount(0);
    });

    // Layout: every element above stays inside the canvas at each QA width.
    test(`${vp.name}: content stays inside the canvas with no clipped elements`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      const splash = page.locator(".m-oh-screen").filter({ visible: true });

      // Measure the settled layout. The job feed is fetched client-side by the
      // mobile splash, so measuring before the cards arrive reads a skeleton of
      // different widths than the page users actually see — which is how a
      // geometry assertion becomes flaky rather than useful.
      await expect(splash.locator(".m-job-carousel-track .oh-job-card").first()).toBeVisible();
      await page.waitForLoadState("networkidle");

      // Two different things get confused here, and only one is a defect.
      //
      // The job carousel is a deliberate horizontal scroller (scroll-snap), so
      // its cards legitimately sit outside their container's right edge — that
      // is the feature. What must never happen is the *page* scrolling
      // sideways, which is what clips content on a phone. So this measures
      // document overflow, and separately checks that no non-scrolling element
      // pokes outside the viewport.
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        const hasScrollableAncestor = (el: HTMLElement) => {
          for (let node = el.parentElement; node; node = node.parentElement) {
            const overflowX = getComputedStyle(node).overflowX;
            if (overflowX === "auto" || overflowX === "scroll") return true;
          }
          return false;
        };

        const escapes: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
          if (el.offsetParent === null) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right <= doc.clientWidth + 1 && r.left >= -1) continue;
          if (hasScrollableAncestor(el)) continue;
          escapes.push(`${el.tagName}.${el.className}`);
        }
        return {
          pageOverflowX: doc.scrollWidth - doc.clientWidth,
          escapes: escapes.slice(0, 10),
        };
      });

      expect(overflow.pageOverflowX, "the page must never scroll horizontally").toBeLessThanOrEqual(0);
      expect(overflow.escapes, "only a deliberate scroller may exceed the viewport").toEqual([]);
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
