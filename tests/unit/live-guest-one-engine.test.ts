import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The one-engine invariant.
 *
 * Odesseus Live exists once. A guest is not a second, smaller product with its
 * own transcript, its own WebRTC path, and its own guidance rendering; it is the
 * same engine pointed at token-scoped routes. These tests are what stop that
 * from eroding.
 *
 * They are source-reading tests on purpose. The property being protected is not
 * a runtime behaviour but an architectural one -- "the engine does not know what
 * a route is" -- and the only honest way to assert it is to read the engine.
 * A behavioral test could only prove that some calls work, not that a fork
 * would be caught.
 */

const ROOT = join(__dirname, "..", "..");

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/**
 * Source with block and line comments removed.
 *
 * Several assertions are about what code *does*, not about what prose mentions.
 * A file that explains itself by naming the route it deliberately avoids should
 * not fail a test asserting it avoids that route.
 */
function code(rel: string): string {
  return source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const ENGINE = "src/components/odesseus-live-client.tsx";

describe("OdesseusLiveClient", () => {
  it("contains no route knowledge at all", () => {
    const t = source(ENGINE);
    // No fetch, no URL, no route segment. Every session call goes through the
    // injected transport.
    expect(t).not.toMatch(/fetch\(/);
    expect(t).not.toMatch(/\/api\//);
  });

  it("builds no URL from the interview id", () => {
    // The engine used to link "Analyze interview" and "Back" at
    // /interviews/<id>. Those are applicant pages. A guest whose prop is the
    // link token would have been handed a button that dead-ends at a login
    // screen -- the one thing a guest with no account must never meet -- so the
    // destinations are injected and the id is not a URL input any more.
    //
    // The default still contains the applicant route, just not in this file.
    expect(source(ENGINE)).not.toContain("/interviews/");
    expect(source("src/lib/live/transport.ts")).toContain("/interviews/");
  });

  it("still owns the whole Live state machine", () => {
    const t = source(ENGINE);
    // If these ever move out, the engine has been split and the guest is on a
    // different implementation than the applicant.
    for (const behaviour of [
      "RTCPeerConnection", // WebRTC negotiation
      "createDataChannel", // realtime transport
      "waitForIceGatheringComplete", // OpenAI needs every candidate in the offer
      "waitForPeerConnected", // an SDP exchange is not a working connection
      "createTurnSequencer", // display order is not arrival order
      "sessionDuration", // the timer
      "saveTranscriptAndGuide", // transcript + guidance per turn
      "retryLive", // recovery without a page reload
    ]) {
      expect(t).toContain(behaviour);
    }
  });

  it("requires explicit consent before any session call", () => {
    const t = source(ENGINE);
    // Consent must gate the transport, not merely decorate the screen.
    expect(t).toContain("consent: true");
    expect(t).toMatch(/disabled=\{!consent/);
  });

  it("defaults to the applicant transport when none is supplied", () => {
    expect(source(ENGINE)).toMatch(/providedTransport\s*\?\?\s*applicantLiveTransport/);
  });

  it("is rendered by the guest surface without being modified", () => {
    // The guest launcher must not build its own Live UI. It hands the existing
    // component a transport and nothing else.
    const launcher = source("src/components/live/guest/live-guest-launcher.tsx");
    expect(launcher).toContain("OdesseusLiveClient");
    expect(launcher).toContain("guestLiveTransport");
    // No second set of WebRTC, transcript, or guidance machinery.
    expect(launcher).not.toMatch(/RTCPeerConnection|createDataChannel|setRemoteDescription/);
  });

  it("keeps every guest button inside the guest's own link", () => {
    // A guest must never be routed into an applicant page, because every one of
    // them redirects an unauthenticated visitor to a login screen.
    //
    // Matched as a quoted literal so the `@/lib/interviews/guest-transport`
    // module import is not mistaken for a route -- a module path is not
    // something anyone can be navigated to.
    const launcher = code("src/components/live/guest/live-guest-launcher.tsx");
    expect(launcher).not.toMatch(/["'`]\/interviews\//);
    expect(launcher).toMatch(/links=\{\{/);
    expect(launcher).toMatch(/workspace:\s*landingUrl/);
    expect(launcher).toMatch(/analysis:\s*analysisUrl/);
  });
});

describe("the guest surfaces", () => {
  it("contain no second Live engine", () => {
    const files = [
      "src/components/live/guest/live-guest-landing.tsx",
      "src/components/live/guest/live-guest-setup.tsx",
      "src/components/live/guest/live-guest-launcher.tsx",
      "src/components/live/guest/live-guest-analysis.tsx",
      "src/components/live/guest-link-card.tsx",
    ];
    for (const file of files) {
      expect(source(file), file).not.toMatch(/RTCPeerConnection|createDataChannel/);
    }
  });

  it("never ask a guest to sign in, sign up, or create an account", () => {
    const files = [
      "src/app/guest-live/[token]/page.tsx",
      "src/app/guest-live/[token]/analysis/page.tsx",
      "src/components/live/guest/live-guest-landing.tsx",
      "src/components/live/guest/live-guest-setup.tsx",
      "src/components/live/guest/live-guest-launcher.tsx",
      "src/components/live/guest/live-guest-analysis.tsx",
    ];
    for (const file of files) {
      const t = source(file);
      // "sign in" appears only in prose saying a guest does not have to.
      const hits = t.match(/sign ?in|log ?in|create an account|sign ?up|forgot password/gi) ?? [];
      for (const hit of hits) {
        const index = t.toLowerCase().indexOf(hit.toLowerCase());
        const context = t.slice(Math.max(0, index - 60), index + 60).toLowerCase();
        expect(
          context.includes("no ") || context.includes("never") || context.includes("without"),
          `${file}: "${hit}" appears without a negation`,
        ).toBe(true);
      }
    }
  });

  it("never render a Live price", () => {
    // Share Annual is a private, auth-gated SKU. A guest-facing or
    // guest-link-facing component that renders a figure would be advertising it
    // on a surface anyone can reach.
    const files = [
      "src/components/live/guest-link-card.tsx",
      "src/components/live/guest/live-guest-landing.tsx",
      "src/components/live/guest/live-guest-setup.tsx",
      "src/components/live/guest/live-guest-launcher.tsx",
      "src/components/live/guest/live-guest-analysis.tsx",
    ];
    for (const file of files) {
      const t = source(file);
      expect(t, file).not.toMatch(/\$\s?\d/);
      expect(t, file).not.toMatch(/liveSkus|billingCatalog|share_annual/);
    }
  });

  it("offer no coding-assistance option to a guest", () => {
    const setup = source("src/components/live/guest/live-guest-setup.tsx");
    // The type list is a plain literal in this file, so it can be asserted
    // directly rather than inferred.
    const options = setup.slice(
      setup.indexOf("const INTERVIEW_TYPES"),
      setup.indexOf("] as const;")
    );
    for (const forbidden of [
      "coding",
      "leetcode",
      "algorithm",
      "take_home",
      "take-home",
      "pair_programming",
      "whiteboard",
    ]) {
      expect(options.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("scope every guest request to the token and nothing else", () => {
    const transport = source("src/lib/interviews/guest-transport.ts");
    // Every call is built from the captured token, and no owner id is available
    // to the module at all.
    expect(transport).toMatch(/encodeURIComponent\(token\)/);
    expect(transport).not.toMatch(/ownerUserId|owner_user_id|userId/);
  });

  it("keep owner-only surfaces out of the guest bundle", () => {
    // A guest page must not pull in anything that reads the owner's data.
    const pages = [
      "src/app/guest-live/[token]/page.tsx",
      "src/app/guest-live/[token]/analysis/page.tsx",
    ];
    for (const page of pages) {
      const t = source(page);
      expect(t, page).not.toMatch(/supabase|createClient|getClaims/);
    }
  });

  it("share one mint state machine between the desktop card and the mobile button", () => {
    // Two implementations of "the server said no" would drift, and the one that
    // drifted would be the one a plan-lapsed owner met.
    const button = source("src/components/live/guest-link-button.tsx");
    expect(button).toMatch(/import\s*{[^}]*requestGuestLink[^}]*}\s*from\s*"\.\/guest-link-card"/);
    // No second fetch to the mint route.
    expect(button).not.toMatch(/\/api\/live\/guest-links/);
  });

  it("gates the owner-side button on a real server-side entitlement read", () => {
    // A button whose request would be refused is worse than one that says the
    // plan does not include it, and a client-side guess would be exactly that.
    for (const page of [
      "src/app/interviews/page.tsx",
      "src/app/mobile/13/page.tsx",
    ]) {
      const t = source(page);
      expect(t, page).toContain("readLiveEntitlement");
      expect(t, page).toContain("canGenerateGuestLinks");
    }
  });

  it("warn a small-viewport guest rather than letting audio fail silently", () => {
    // The engine is desktop-only (stated on the mobile Live screen), and a guest
    // on a phone is the most likely guest of all. Advisory: the engine still
    // renders, so nothing is disabled by a user-agent guess.
    const launcher = source("src/components/live/guest/live-guest-launcher.tsx");
    expect(launcher).toContain("needs a larger screen");
    expect(launcher).toContain("useSyncExternalStore");
    // The engine is rendered unconditionally alongside the warning.
    expect(launcher).toMatch(/<OdesseusLiveClient/);
  });
});
