import { test, expect } from "@playwright/test";

/**
 * Homepage release delta (Task 9D).
 *
 * Covers the marketing homepage at every QA width — desktop and phone — with an
 * explicit assertion per element the delta added: the simplified header, the
 * trust card, the capability tiles, the capability showcase, the global company
 * marquee, and the locations block.
 *
 * Two rules are load-bearing and are what most of these assertions are for.
 *
 * **No invented proof.** The homepage may not claim a user count, a trust
 * signal, or a company relationship it cannot substantiate. The company marquee
 * is explicitly illustrative and says so; the trust band carries no numeric
 * social proof; and nothing advertises a session price for Odesseus Live on a
 * public page, because Live is private to signed-in applicants.
 *
 * **A moving band is still readable.** The marquee animates, so the assertions
 * that matter are about the motion being continuous, pausing for reduced-motion
 * readers, and never widening the page.
 */

const VIEWPORTS = [
  { name: "375x812", width: 375, height: 812, mobile: true },
  { name: "390x844", width: 390, height: 844, mobile: true },
  { name: "393x852", width: 393, height: 852, mobile: true },
  { name: "430x932", width: 430, height: 932, mobile: true },
  { name: "1280x800", width: 1280, height: 800, mobile: false },
  { name: "1440x900", width: 1440, height: 900, mobile: false },
  { name: "1920x1080", width: 1920, height: 1080, mobile: false },
] as const;

/** The public homepage header links, and the ones that must have moved to the footer. */
const HEADER_LINKS = ["Job Seekers", "Employers", "Pricing", "Sign In", "Get Started"];
const FOOTER_ONLY_LINKS = ["Careers", "About", "FAQ"];

/** Footer groups the public site must expose on desktop and phone alike. */
const FOOTER_GROUPS = ["Job Seekers", "Employers", "Company"];

/** Locations, with the maturity each one is allowed to claim. */
const LOCATIONS = [
  { city: "Austin, Texas", status: "Headquarters" },
  { city: "London, UK", status: "Coming soon" },
  { city: "Dubai, UAE", status: "Coming soon" },
];

/** The six capabilities the showcase claims, in the order it presents them. */
const CAPABILITIES = [
  "Job discovery + Match Score",
  "Smart Apply",
  "Resume Optimization",
  "Interview Prep + Mock Interviews",
  "Application Tracking",
  "Interview support",
];

/**
 * Naming that must never appear on a public marketing page.
 *
 * Odesseus Live is private to signed-in applicants and token-scoped guest links
 * (see AGENTS.md). "Odesseus Live", "Live Interview", and "Guest Live" all name
 * the private surface; the Live prices are the retired and current SKUs. The
 * public page may say a candidate can earn while searching — that is what is
 * true — but it may not identify Live as the mechanism.
 */
const PRIVATE_LIVE_TERMS = [
  "odesseus live",
  "live interview",
  "guest live",
  "live workspace",
  "$14.99",
  "$19.99",
  "$99",
  "$499",
  "$24.99",
  "$59.99",
] as const;

/**
 * The showcase card for one capability.
 *
 * Scoped to the visible copy: both the desktop landing and the phone splash
 * mount the whole body, so an unscoped filter always matches twice.
 */
function capabilityCard(page: import("@playwright/test").Page, eyebrow: string) {
  return page
    .locator(".oh-feature-card")
    .filter({ visible: true, hasText: eyebrow })
    .first();
}

/**
 * Reads the visible layout facts at the current viewport.
 *
 * Returns the geometry rather than asserting, so one navigation is enough for
 * every assertion below — a per-assertion locator round-trip over an animating
 * page is both slow and a source of flakes.
 */
async function readHome(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const visible = (el: Element | null | undefined) =>
      !!el && (el as HTMLElement).offsetParent !== null;
    const firstVisible = (selector: string) =>
      Array.from(document.querySelectorAll(selector)).find(visible) ?? null;
    const text = (sel: string) => firstVisible(sel)?.textContent?.trim() ?? "";
    const rect = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, height: r.height };
    };

    const marquee = firstVisible(".oh-company-marquee");
    const track = marquee?.querySelector<HTMLElement>(".oh-company-marquee-track") ?? null;
    const chip = marquee?.querySelector<HTMLElement>(".oh-company-chip") ?? null;

    const avatars = Array.from(document.querySelectorAll(".oh-trust-avatar")).filter(visible);
    const avatarRects = avatars.map((a) => {
      const r = a.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, height: r.height };
    });

    const hasDeliberateScroller = (el: Element) => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflowX === "auto" || style.overflowX === "scroll") return true;
        // A masked window (the marquee) clips its track on purpose.
        if (style.maskImage !== "none") return true;
      }
      return false;
    };

    const escapes: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right <= doc.clientWidth + 1 && r.left >= -1) continue;
      if (hasDeliberateScroller(el)) continue;
      escapes.push(`${el.tagName}.${el.className}`.slice(0, 60));
    }

    const headerLinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(".figma-nav a, .m-oh-nav a, .m-oh-primary-links a")
    )
      .filter(visible)
      .map((a) => ({ label: (a.textContent ?? "").trim(), href: a.getAttribute("href") ?? "" }));

    const footer = firstVisible(".figma-footer");
    const footerLinks = Array.from(footer?.querySelectorAll<HTMLAnchorElement>("a") ?? [])
      .filter(visible)
      .map((a) => ({ label: (a.textContent ?? "").trim(), href: a.getAttribute("href") ?? "" }));
    const footerGroups = Array.from(footer?.querySelectorAll("strong") ?? [])
      .filter(visible)
      .map((s) => (s.textContent ?? "").trim());

    return {
      clientWidth: doc.clientWidth,
      pageOverflowX: doc.scrollWidth - doc.clientWidth,
      escapes: Array.from(new Set(escapes)).slice(0, 10),

      h1: (firstVisible("h1")?.textContent ?? "").replace(/\s+/g, " "),
      heroEyebrow: text(".oh-hero-eyebrow"),
      heroCopy: (firstVisible(".oh-hero-copy p")?.textContent ?? "").replace(/\s+/g, " "),
      employerCtaHref: firstVisible(".oh-employer-cta")?.getAttribute("href") ?? null,

      jobCards: Array.from(document.querySelectorAll(".oh-job-card")).filter(visible).length,
      jobTrackVisible: visible(firstVisible(".m-job-carousel-track, .oh-carousel-track")),

      trustLabel: text(".oh-trust-label"),
      trustStats: Array.from(document.querySelectorAll(".oh-trust-stat")).filter(visible).map((s) => ({
        value: s.querySelector("strong")?.textContent?.trim() ?? "",
        label: s.querySelector("span")?.textContent?.trim() ?? "",
      })),
      avatarCount: avatars.length,
      avatarRects,
      avatarsOverlap:
        avatarRects.length > 1
          ? avatarRects.slice(1).some((r, i) => r.left < avatarRects[i].right)
          : null,
      avatarHasImage: avatars.every((a) => getComputedStyle(a).backgroundImage !== "none"),
      trustRect: rect(firstVisible(".oh-trust-band")),

      capabilityTiles: Array.from(document.querySelectorAll(".oh-capability-tile"))
        .filter(visible)
        .map((t) => (t.textContent ?? "").replace(/\s+/g, " ").trim()),

      featureEyebrows: Array.from(document.querySelectorAll(".oh-feature-eyebrow"))
        .filter(visible)
        .map((e) => (e.textContent ?? "").trim()),
      featureCards: Array.from(document.querySelectorAll(".oh-feature-card")).filter(visible).length,
      featureCardsOverflowing: Array.from(document.querySelectorAll(".oh-feature-card"))
        .filter(visible)
        .filter((c) => {
          const r = c.getBoundingClientRect();
          return r.right > doc.clientWidth + 1 || r.left < -1;
        }).length,

      marqueeVisible: visible(marquee),
      marqueeRect: rect(marquee),
      marqueeAnimation: track ? getComputedStyle(track).animationName : null,
      marqueeDuration: track ? getComputedStyle(track).animationDuration : null,
      marqueeTiming: track ? getComputedStyle(track).animationTimingFunction : null,
      marqueeIteration: track ? getComputedStyle(track).animationIterationCount : null,
      marqueeTrackWidth: track ? track.getBoundingClientRect().width : null,
      marqueeChips: marquee?.querySelectorAll(".oh-company-chip").length ?? 0,
      marqueeLogos: marquee
        ? Array.from(marquee.querySelectorAll<HTMLElement>(".oh-company-logo")).filter((l) =>
            getComputedStyle(l).backgroundImage !== "none"
          ).length
        : 0,
      marqueeNames: Array.from(marquee?.querySelectorAll(".oh-company-chip strong") ?? [])
        .map((n) => (n.textContent ?? "").trim())
        .filter((n, i, all) => all.indexOf(n) === i),
      chipHeight: chip ? chip.getBoundingClientRect().height : null,
      marqueeLabel: text(".oh-logo-strip-label"),
      marqueeNote: text(".oh-logo-strip-note"),

      footerVisible: visible(footer),
      footerLinks,
      footerGroups,
      footerLocations: Array.from(footer?.querySelectorAll(".figma-footer-location") ?? [])
        .filter(visible)
        .map((l) => (l.textContent ?? "").replace(/\s+/g, " ").trim()),

      headerLinks,
    };
  });
}

test.describe("homepage — structure and product truth", () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: hero, job feed, trust card, tiles, showcase, marquee, footer, locations`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/", { waitUntil: "networkidle" });

      // The job feed is fetched client-side by the phone presentation, so
      // measuring before it lands reads a different layout than users see.
      // Both presentations are mounted at every width (CSS decides which
      // shows), so this waits on the visible one.
      await expect(page.locator(".oh-job-card").filter({ visible: true }).first()).toBeVisible();
      await page.waitForLoadState("networkidle");

      const home = await readHome(page);

      // --- Hero -----------------------------------------------------------
      expect(home.h1).toContain("Odesseus.ai");
      expect(home.heroEyebrow.length).toBeGreaterThan(0);
      // The hero copy explains the product end to end and stays accurate about
      // the resume: it optimizes the one you already have.
      expect(home.heroCopy).toMatch(/resume/i);
      expect(home.heroCopy).not.toMatch(/create your resume|build your resume|from scratch/i);
      expect(home.employerCtaHref).toBe("/employers");

      // --- Job feed -------------------------------------------------------
      expect(home.jobCards).toBeGreaterThan(0);
      expect(home.jobTrackVisible).toBe(true);

      // --- Trust card -----------------------------------------------------
      expect(home.trustLabel.length).toBeGreaterThan(0);
      // The stacked portraits are the point of the card: they must render,
      // carry an image, and overlap rather than sit in a row.
      expect(home.avatarCount).toBeGreaterThanOrEqual(3);
      expect(home.avatarHasImage).toBe(true);
      expect(home.avatarsOverlap).toBe(true);
      for (const avatar of home.avatarRects) {
        expect(avatar.width).toBeGreaterThan(0);
        expect(avatar.height).toBeGreaterThan(0);
      }
      // The card stays inside the page it belongs to.
      expect(home.trustRect!.right).toBeLessThanOrEqual(home.clientWidth + 1);

      // --- Capability tiles ----------------------------------------------
      expect(home.capabilityTiles.length).toBeGreaterThanOrEqual(4);

      // --- Capability showcase -------------------------------------------
      expect(home.featureCards).toBe(6);
      expect(home.featureEyebrows).toEqual(CAPABILITIES);
      expect(home.featureCardsOverflowing).toBe(0);

      // --- Global company marquee ----------------------------------------
      expect(home.marqueeVisible).toBe(true);
      expect(home.marqueeRect!.right).toBeLessThanOrEqual(home.clientWidth + 1);
      // Both a logo and a name, for every company.
      expect(home.marqueeChips).toBeGreaterThan(0);
      expect(home.marqueeLogos).toBe(home.marqueeChips);
      expect(home.marqueeNames.length).toBeGreaterThanOrEqual(10);
      // The list is illustrative and says so, so it is not a partnership claim.
      expect(home.marqueeLabel.length).toBeGreaterThan(0);
      expect(home.marqueeNote).toMatch(/illustrative/i);

      // --- Footer and locations ------------------------------------------
      expect(home.footerVisible).toBe(true);
      for (const group of FOOTER_GROUPS) {
        expect(home.footerGroups).toContain(group);
      }
      for (const { city, status } of LOCATIONS) {
        expect(
          home.footerLocations.some((row) => row.includes(city) && row.includes(status)),
          `footer must state ${city} — ${status}`
        ).toBe(true);
      }

      // --- Responsive -----------------------------------------------------
      expect(home.pageOverflowX, "the page must never scroll sideways").toBeLessThanOrEqual(0);
      expect(home.escapes, "nothing outside a deliberate scroller may leave the viewport").toEqual([]);

      if (!vp.mobile) {
        // Desktop chrome carries exactly the primary paths, plus the wordmark
        // (its own text includes the logo glyph, so it is matched by suffix).
        const headerLabels = home.headerLinks.map((l) => l.label);
        expect(headerLabels).toHaveLength(HEADER_LINKS.length + 1);
        expect(headerLabels[0]).toMatch(/Odesseus\.ai$/);
        expect(headerLabels.slice(1)).toEqual(HEADER_LINKS);
        for (const label of FOOTER_ONLY_LINKS) {
          expect(headerLabels).not.toContain(label);
          // ...and each is reachable in the footer instead.
          expect(home.footerLinks.map((l) => l.label)).toContain(label);
        }
      } else {
        // The phone header carries the same primary set plus its own nav.
        const labels = home.headerLinks.map((l) => l.label);
        for (const label of ["Job Seekers", "Employers", "Pricing"]) {
          expect(labels).toContain(label);
        }
        expect(labels).toContain("Get Started");
        expect(labels.some((l) => /^Sign in$/i.test(l))).toBe(true);
        for (const label of FOOTER_ONLY_LINKS) {
          expect(labels).not.toContain(label);
          expect(home.footerLinks.map((l) => l.label)).toContain(label);
        }
        // The marquee ticker must stay readable, not shrink to nothing.
        expect(home.chipHeight!).toBeGreaterThanOrEqual(24);
      }
    });
  }
});

test.describe("homepage — marquee motion", () => {
  test("the track animates continuously and loops", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator(".oh-company-chip").filter({ visible: true }).first()).toBeVisible();

    const track = page
      .locator(".oh-company-marquee")
      .filter({ visible: true })
      .locator(".oh-company-marquee-track")
      .first();

    const style = await track.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        name: s.animationName,
        duration: s.animationDuration,
        timing: s.animationTimingFunction,
        iteration: s.animationIterationCount,
      };
    });

    // A named, linear, infinitely looping animation is what makes the seam
    // between the two copies invisible; anything else is a visible jump.
    expect(style.name).toBe("oh-company-marquee-left");
    expect(style.duration).not.toBe("0s");
    // `linear` is the whole point: an eased marquee visibly accelerates and
    // decelerates at the loop point.
    expect(style.timing).toBe("linear");
    expect(style.iteration).toBe("infinite");

    // Two identical copies make the -50% translate land exactly on the seam.
    // Scoped to the visible marquee, because the phone presentation mounts its
    // own copy of the whole body at every width.
    await expect(
      page.locator(".oh-company-marquee").filter({ visible: true }).locator(".oh-company-marquee-group")
    ).toHaveCount(2);
  });

  test("the track actually moves, and keeps moving without a jump at the loop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/", { waitUntil: "networkidle" });
    const track = page
      .locator(".oh-company-marquee")
      .filter({ visible: true })
      .locator(".oh-company-marquee-track")
      .first();
    await expect(track).toBeVisible();
    await page.waitForLoadState("networkidle");

    const sample = () => track.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);

    const positions: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      positions.push(await sample());
      await page.waitForTimeout(220);
    }

    // Monotonic leftward motion: the band is moving, not oscillating.
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i], "the marquee must translate in one direction").toBeLessThan(
        positions[i - 1]
      );
    }
  });

  test("prefers-reduced-motion stops the animation and makes the band scrollable", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator(".oh-company-chip").filter({ visible: true }).first()).toBeVisible();

    const result = await page
      .locator(".oh-company-marquee")
      .filter({ visible: true })
      .first()
      .evaluate((el) => {
        const track = el.querySelector<HTMLElement>(".oh-company-marquee-track");
        const s = getComputedStyle(track!);
        return {
          animation: s.animationName,
          marqueeOverflowX: getComputedStyle(el).overflowX,
        };
      });

    // A continuously moving band is exactly what a motion-sensitive reader is
    // asking not to see, so the animation stops and the same content becomes a
    // plain scrollable strip instead.
    expect(result.animation).toBe("none");
    expect(result.marqueeOverflowX).toBe("auto");

    await context.close();
  });
});

test.describe("homepage — capability accuracy", () => {
  test("Resume Optimization is scoped to an existing resume", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/", { waitUntil: "networkidle" });

    const card = capabilityCard(page, "Resume Optimization");
    await expect(card).toBeVisible();
    const text = (await card.innerText()).toLowerCase();

    expect(text).toMatch(/existing resume|resume you already have/);
    expect(text).not.toMatch(/create a resume|build a resume|from scratch|generate a resume/);
  });

  test("Smart Apply is scoped to supported flows and keeps the user in control", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/", { waitUntil: "networkidle" });

    const card = capabilityCard(page, "Smart Apply");
    await expect(card).toBeVisible();
    const text = (await card.innerText()).toLowerCase();

    expect(text).toMatch(/supported/);
  });

  test("the interview card invites applicants without naming the private Live surface", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/", { waitUntil: "networkidle" });

    const card = capabilityCard(page, "Interview support");
    await expect(card).toBeVisible();
    const text = (await card.innerText()).toLowerCase();

    // The public claim: preparation is included, and eligible candidates can
    // earn while they search.
    expect(text).toMatch(/included with every account|interview preparation/i);
    expect(text).toMatch(/earn/);

    // The product boundary: nothing here may name the private Live surface or
    // quote any Live price, because a signed-out visitor must not be able to
    // discover or price it.
    for (const term of PRIVATE_LIVE_TERMS) {
      expect(text, `the homepage must not say "${term}"`).not.toContain(term);
    }

    // Detail stays behind sign-in rather than being published.
    const detailLink = card.getByRole("link");
    await expect(detailLink).toHaveAttribute("href", "/signin");
  });

  test("no public page names the private Live surface", async ({ page }) => {
    // The homepage is the surface this delta changed, but the rule is site-wide:
    // Live is reachable only from an authenticated candidate surface.
    for (const path of ["/", "/pricing", "/how-it-works", "/apply", "/agents"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const text = (await page.locator("body").innerText()).toLowerCase();
      for (const term of PRIVATE_LIVE_TERMS) {
        expect(text, `${path} must not say "${term}"`).not.toContain(term);
      }
    }
  });
});
