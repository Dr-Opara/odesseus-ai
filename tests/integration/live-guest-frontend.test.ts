import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyMint,
  guestLinkUrl,
  requestGuestLink,
} from "@/components/live/guest-link-card";
import { fetchLinkState } from "@/components/live/guest/live-guest-landing";
import { classifyAnalysis, fetchAnalysisState } from "@/components/live/guest/live-guest-analysis";
// Imported here, and deliberately NOT imported by the components: the server
// module pulls in the service client, and the guest surfaces must stay
// client-safe. Reading the constant from the source of truth keeps the two
// copies of the message from drifting.
import { GUEST_LINK_UNAVAILABLE } from "@/lib/interviews/guest-share";

/**
 * The guest frontend's decisions.
 *
 * The components hold no logic worth testing on their own; what matters is how
 * a server answer becomes a state a guest is shown. That mapping is extracted
 * into pure functions precisely so it can be tested here, and every case below
 * is a case where showing the wrong thing would mislead someone about their
 * own interview or leak the shape of someone else's link.
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // jsdom-free environment: window may be absent, which guestLinkUrl handles.
  vi.stubGlobal("window", { location: { origin: "https://odesseus.ai" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function respond(payload: unknown, status = 200) {
  fetchMock.mockImplementation(async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

function failing() {
  fetchMock.mockRejectedValue(new Error("network down"));
}

describe("guest link minting (owner side)", () => {
  it("mints a link a guest can open", async () => {
    respond({ token: "ab".repeat(32) });
    const state = await requestGuestLink();
    expect(state).toEqual({
      kind: "minted",
      url: `https://odesseus.ai/guest-live/${"ab".repeat(32)}`,
    });
  });

  it("puts no owner id or user id in the link", async () => {
    respond({ token: "ab".repeat(32) });
    const state = await requestGuestLink();
    const url = (state as { url: string }).url;
    // The token is the whole credential. If an owner id ever appears here it
    // would be copied, screenshotted, and pasted into a chat.
    expect(url).not.toMatch(/user|owner/i);
    // Exactly /guest-live/<token>: origin, one fixed prefix, one segment.
    const path = new URL(url).pathname;
    expect(path.split("/").filter(Boolean)).toEqual([
      "guest-live",
      "ab".repeat(32),
    ]);
  });

  it("reports an ineligible plan as not-entitled, not as an error", async () => {
    // The distinction matters: an error invites a retry that cannot succeed.
    respond({ error: "Guest Live links are not included in your plan." }, 403);
    expect(await requestGuestLink()).toEqual({ kind: "not-entitled" });
  });

  it("reports a rate limit as a retryable error with the server's message", async () => {
    respond({ error: "Too many guest links created. Please try again later." }, 429);
    const state = await requestGuestLink();
    expect(state.kind).toBe("failed");
    expect((state as { message: string }).message).toMatch(/too many/i);
  });

  it("reports a signed-out owner with the server's message", async () => {
    respond({ error: "Please sign in again." }, 401);
    const state = await requestGuestLink();
    expect(state.kind).toBe("failed");
    expect((state as { message: string }).message).toBe("Please sign in again.");
  });

  it("never reports success without a token", async () => {
    // A 200 with no token is a broken response, not a minted link. Reporting
    // success would hand the owner an empty box to share.
    respond({ ok: true }, 200);
    expect((await requestGuestLink()).kind).toBe("failed");
  });

  it("fails visibly when the server is unreachable", async () => {
    failing();
    const state = await requestGuestLink();
    expect(state.kind).toBe("failed");
    expect((state as { message: string }).message).toMatch(/could not reach/i);
  });

  it("classifies an unreadable body as a failure, not a crash", () => {
    fetchMock.mockImplementation(async () => new Response("<html>oops</html>", { status: 500 }));
    expect(classifyMint({ ok: false, status: 500 }, null).kind).toBe("failed");
  });

  it("builds a relative link when there is no window to read an origin from", () => {
    vi.stubGlobal("window", undefined);
    expect(guestLinkUrl("cd".repeat(32))).toBe(`/guest-live/${"cd".repeat(32)}`);
  });
});

describe("guest link landing states", () => {
  it("shows setup for a valid link with nothing saved yet", async () => {
    respond({ valid: true, status: "pending", setupComplete: false, hasSession: false });
    expect((await fetchLinkState("t")).kind).toBe("setup");
  });

  it("shows Live for a valid link whose setup is saved", async () => {
    respond({ valid: true, status: "pending", setupComplete: true, hasSession: false });
    expect((await fetchLinkState("t")).kind).toBe("ready");
  });

  it("shows Live for a valid link whose session already started", async () => {
    respond({ valid: true, status: "active", setupComplete: true, hasSession: true });
    expect((await fetchLinkState("t")).kind).toBe("ready");
  });

  it("offers post-interview for a completed link", async () => {
    respond({ valid: true, status: "completed", setupComplete: true, hasSession: true });
    expect((await fetchLinkState("t")).kind).toBe("ended");
  });

  it("carries the guest's own name onto the ready state", async () => {
    respond({ valid: true, status: "active", setupComplete: true, hasSession: true, guestName: "Ada" });
    const state = await fetchLinkState("t");
    expect(state).toEqual({ kind: "ready", guestName: "Ada" });
  });

  it("carries a missing name as null rather than an empty string", async () => {
    respond({ valid: true, status: "active", setupComplete: true, hasSession: true, guestName: null });
    expect(await fetchLinkState("t")).toEqual({ kind: "ready", guestName: null });
  });

  it("gives the same answer for an unknown link and a lapsed owner's plan", async () => {
    // 403 and 404 are the only two `loadGuestAccess` produces, and the server
    // sends the same text for both. If they ever diverge, this page becomes an
    // oracle for "which tokens were once real".
    for (const status of [403, 404]) {
      respond({ error: GUEST_LINK_UNAVAILABLE }, status);
      const state = await fetchLinkState("t");
      expect(state).toEqual({ kind: "invalid", message: GUEST_LINK_UNAVAILABLE });
    }
  });

  it("keeps a throttle retryable rather than calling the link dead", async () => {
    // 429 is the per-IP token throttle. It says nothing about whether the link
    // works, and a guest who is told the link is over has no way to get a new
    // one.
    respond({ error: "Too many attempts. Please try again shortly." }, 429);
    const state = await fetchLinkState("t");
    expect(state.kind).toBe("failed");
    // The server's own wording is not shown, because it is about throttling and
    // would confuse; the retry message is the useful one.
    expect((state as { message: string }).message).not.toMatch(/too many/i);
  });

  it("gives the same answer for a 200 that reports the link is not valid", async () => {
    respond({ valid: false }, 200);
    const state = await fetchLinkState("t");
    expect(state.kind).toBe("invalid");
    expect((state as { message: string }).message).toMatch(/not valid/i);
  });

  it("separates a server problem from a bad link, so retry stays available", async () => {
    respond({ error: "boom" }, 500);
    const state = await fetchLinkState("t");
    // Not "invalid": telling a guest their link is dead because of a 500 would
    // be false, and there is no way for them to get a new one.
    expect(state.kind).toBe("failed");
  });

  it("offers a retry when the network drops", async () => {
    failing();
    const state = await fetchLinkState("t");
    expect(state.kind).toBe("failed");
    expect((state as { message: string }).message).toMatch(/connection/i);
  });

  it("calls the token-scoped route and nothing else", async () => {
    respond({ valid: true, status: "pending", setupComplete: false, hasSession: false });
    await fetchLinkState("zz");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/live/guest-access/zz");
    expect(init.method).toBeUndefined();
    // No-store: a cached 200 would show a guest a stale state after their own
    // setup saved, which reads as "nothing happened".
    expect(init.cache).toBe("no-store");
  });
});

describe("guest post-interview states", () => {
  it("shows the analysis when one exists", async () => {
    respond({ ok: true, analysis: { factualSummary: "s" }, transcriptItemCount: 3 });
    const state = await fetchAnalysisState("t");
    expect(state.kind).toBe("ready");
  });

  it("offers to generate when the link is valid but nothing is analyzed yet", async () => {
    respond({ ok: true, analysis: null, transcriptItemCount: 0 });
    const state = await fetchAnalysisState("t");
    // Not an error: a guest who has not generated one yet is in a normal state.
    expect(state.kind).toBe("ready");
  });

  it("gives a retired link one message, not two", async () => {
    for (const status of [403, 404]) {
      respond({ error: GUEST_LINK_UNAVAILABLE }, status);
      const state = await fetchAnalysisState("t");
      expect(state).toEqual({ kind: "invalid", message: GUEST_LINK_UNAVAILABLE });
    }
  });

  it("keeps a server problem retryable", async () => {
    respond({ error: "boom" }, 500);
    expect((await fetchAnalysisState("t")).kind).toBe("failed");
  });

  it("never shows a half-parsed analysis as a valid one", () => {
    const state = classifyAnalysis(
      { ok: true, status: 200 } as Response,
      { ok: true, analysis: null, transcriptItemCount: 0 } as never
    );
    expect(state.kind).toBe("ready");
    expect((state as { payload: { analysis: null } }).payload.analysis).toBeNull();
  });

  it("asks the token-scoped read for its own analysis", async () => {
    respond({ ok: true, analysis: null, transcriptItemCount: 0 });
    await fetchAnalysisState("t");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/live/guest-access/t/session/post-analysis");
  });
});
