"use client";

import Link from "next/link";
import { mobileScreens } from "@/lib/mobile/screen-map";

/** Screen 00's approved canvas height (src/lib/mobile/screen-map.ts). */
const SCREEN_00 = mobileScreens.find((screen) => screen.index === "00");
const MIN_HEIGHT = SCREEN_00?.minHeight ?? 844;

/**
 * The lavender gutter always fills the viewport (`100svh`) so there is never a
 * bare strip below the dark card, and it never shrinks below the approved
 * 844px artboard on the shorter QA phones.
 */
const CANVAS_HEIGHT = `max(${MIN_HEIGHT}px, 100svh)`;

/**
 * Mobile Splash (screen 00) — the public landing at phone width.
 *
 * Single source of truth for Screen 00: the production mobile homepage (`/`
 * under the mobile breakpoint) renders this component, and the QA preview
 * (`/qa/mobile/00`) frames the real `/` route in an iframe, so both paths
 * always show the exact same approved Figma experience. The desktop
 * marketing landing lives in `src/app/page.tsx` and is untouched by this
 * component.
 *
 * The job-card stack (NVIDIA/Amazon/Google/Microsoft and the GenAI Security
 * Engineer foreground card), headline accents, pagination, stats and footer
 * are approved Figma marketing elements — illustrative live-job examples,
 * not a claim about real openings and never candidate data.
 *
 * The three public entry points are the whole signed-out mobile contract:
 * Get Started -> /signup, Business Login -> /employers/login, and
 * See Pricing -> /pricing.
 */
export default function MobileSplash() {
  return (
    <main className="m-splash odesseus-mobile-only" style={{ minHeight: CANVAS_HEIGHT }}>
      <div className="m-splash-card">
        <span className="m-splash-orb m-splash-orb-tl-a" aria-hidden="true" />
        <span className="m-splash-orb m-splash-orb-tl-b" aria-hidden="true" />
        <span className="m-splash-orb m-splash-orb-br-a" aria-hidden="true" />
        <span className="m-splash-orb m-splash-orb-br-b" aria-hidden="true" />

        <div className="m-stack">
          <div className="m-stack-card m-stack-nvidia">NVIDIA</div>
          <div className="m-stack-card m-stack-amazon">Amazon</div>
          <div className="m-stack-card m-stack-google">Google</div>
          <div className="m-stack-card m-stack-ms">
            <div className="m-stack-ms-top">
              <span className="m-stack-ms-logo" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              <b>Microsoft</b>
              <span className="m-stack-heart" aria-hidden="true">♡</span>
            </div>
            <h2>
              GenAI Security
              <br />
              Engineer
            </h2>
            <small>Full time&nbsp;&nbsp;|&nbsp;&nbsp;$247K</small>
            <div className="m-stack-ms-actions">
              <span className="m-stack-pill">
                See Details <b aria-hidden="true">→</b>
              </span>
              <span className="m-stack-next">Next Match →</span>
            </div>
          </div>
        </div>

        <h1>
          Discover Your
          <br />
          <em>Dream Job</em>
          <br />
          with <em>Odesseus.ai</em>
        </h1>
        <p>
          Find roles that fit your experience, strengthen your resume, apply with your
          approval, and prepare for what comes next.
        </p>
        <div className="m-splash-ctas">
          <Link href="/signup" className="m-splash-cta is-primary">
            Get Started <b aria-hidden="true">→</b>
          </Link>
          <Link href="/employers/login" className="m-splash-cta is-ghost">
            Business Login
          </Link>
        </div>
        <Link href="/pricing" className="m-splash-cta-wide">
          See Pricing <b aria-hidden="true">→</b>
        </Link>

        <div className="m-splash-pagination" aria-hidden="true">
          <span className="m-dot is-active" />
          <span className="m-dot" />
          <span className="m-dot" />
          <span className="m-dot" />
        </div>
        <p className="m-splash-swipe-hint">Swipe through live job matches</p>

        <div className="m-splash-stats">
          <span><b>500K+</b><small>Applicants</small></span>
          <span><b>100K+</b><small>Hires</small></span>
          <span><b>10+</b><small>Countries</small></span>
          <span><b>95%</b><small>Satisfaction</small></span>
        </div>

        <div className="m-splash-footer">
          <strong>Odesseus.ai</strong>
          <span>Career agents built around your approval.</span>
        </div>
      </div>
    </main>
  );
}