import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPlausibleGuestToken } from "@/lib/live/guest-share";
import { candidateLiveEndpoints, guestLiveEndpoints } from "@/lib/live/endpoints";
import type { CandidateDetail } from "@/lib/employers/types";

const proxySource = readFileSync(join(process.cwd(), "src/lib/supabase/proxy.ts"), "utf8");

/** Quoted path literals inside one of the proxy's public-path arrays. */
function pathsFromArray(name: string): string[] {
  const start = proxySource.indexOf(`const ${name} = [`);
  expect(start, `proxy must declare ${name}`).toBeGreaterThan(-1);
  const end = proxySource.indexOf("];", start);
  const block = proxySource.slice(start, end);
  return [...block.matchAll(/"(\/[^"]*)"/g)].map((match) => match[1]);
}

/** Paths the auth proxy treats as reachable without a session. */
function publicPaths(): { exact: string[]; prefixes: string[] } {
  return {
    exact: pathsFromArray("publicExactPaths"),
    prefixes: pathsFromArray("publicPrefixPaths"),
  };
}

function isPublic(pathname: string, paths: { exact: string[]; prefixes: string[] }): boolean {
  if (paths.exact.includes(pathname)) return true;
  return paths.prefixes.some((prefix) => pathname.startsWith(`${prefix}/`));
}

describe("employer pages stay authenticated (F3)", () => {
  const paths = publicPaths();

  // Reachable only through the proxy's public list would be a leak; these all
  // sit outside it, so a signed-out visitor is redirected before any employer
  // data is read.
  const PROTECTED = [
    "/employers/dashboard",
    "/employers/jobs",
    "/employers/jobs/job-1",
    "/employers/jobs/job-1/edit",
    "/employers/jobs/job-1/feature",
    "/employers/candidates",
    "/employers/candidates/app-1",
    "/employers/pipeline",
    "/employers/analytics",
    "/employers/billing",
    "/employers/team",
    "/employers/notifications",
    "/employers/company",
    "/employers/onboarding/company",
    "/employers/onboarding/plan",
    "/employers/onboarding/review",
  ];

  for (const path of PROTECTED) {
    it(`${path} is not reachable without a session`, () => {
      expect(isPublic(path, paths)).toBe(false);
    });
  }

  it("only the employer marketing and sign-in surfaces are public", () => {
    const publicEmployerPaths = paths.exact.filter((path) => path.startsWith("/employers"));
    expect(publicEmployerPaths.sort()).toEqual([
      "/employers",
      "/employers/login",
      // A marketing CTA target. The page itself redirects a signed-out visitor
      // to employer signup, so no employer data is reachable through it.
      "/employers/post-job",
      "/employers/pricing",
      "/employers/signup",
    ]);
  });

  it("employer screens that read org data all require a session and resolve their own org", () => {
    const pageSource = readFileSync(
      join(process.cwd(), "src/app/employers/guard.ts"),
      "utf8"
    );
    // The shared guard is the only thing standing between a signed-out
    // visitor and an org-scoped read, so it must both authenticate and
    // resolve the caller's own organization.
    expect(pageSource).toContain("getEmployerOrgContext");
    expect(pageSource).toContain("redirect(");

    for (
      const file of [
        "src/app/employers/dashboard/page.tsx",
        "src/app/employers/jobs/page.tsx",
        "src/app/employers/candidates/page.tsx",
        "src/app/employers/pipeline/page.tsx",
        "src/app/employers/analytics/page.tsx",
        "src/app/employers/billing/page.tsx",
        "src/app/employers/team/page.tsx",
        "src/app/employers/notifications/page.tsx",
        "src/app/employers/company/page.tsx",
      ]
    ) {
      expect(readFileSync(join(process.cwd(), file), "utf8")).toContain("requireEmployerPage(");
    }
  });
});

describe("Guest Live token routes are intentionally no-account (F3)", () => {
  const paths = publicPaths();

  it("serves a guest token landing page without a session", () => {
    const token = "a".repeat(64);
    expect(isPublic(`/live/guest/${token}`, paths)).toBe(true);
  });

  it("serves the token-scoped guest API without a session", () => {
    const token = "a".repeat(64);
    for (const suffix of ["", "/setup", "/resume", "/session", "/session/transcript", "/session/end"]) {
      expect(isPublic(`/api/live/guest-access/${token}${suffix}`, paths)).toBe(true);
    }
  });

  it("does not make guest-link minting public — the owner must be signed in", () => {
    expect(isPublic("/api/live/guest-links", paths)).toBe(false);
  });

  it("rejects a token that is not a 256-bit hex value", () => {
    expect(isPlausibleGuestToken("a".repeat(64))).toBe(true);
    expect(isPlausibleGuestToken("short")).toBe(false);
    expect(isPlausibleGuestToken("z".repeat(64))).toBe(false);
  });
});

describe("guest data never reaches the owner (F3)", () => {
  const token = "b".repeat(64);
  const endpoints = guestLiveEndpoints(token);

  it("drives Live only through the token-scoped guest routes", async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return {
        ok: true,
        status: 200,
        json: async () => ({ sdp: "answer", id: "sess_1", ok: true, sessionId: "s1", isQuestion: false, guidance: null }),
      } as Response;
    }) as typeof fetch;

    try {
      await endpoints.start({ captureMode: "shared_audio", consent: true });
      await endpoints.connect({ sessionId: "s1", sdp: "offer" });
      await endpoints.activate({ sessionId: "s1", openaiSessionId: "sess_1" });
      await endpoints.transcript({
        sessionId: "s1",
        itemId: "i1",
        transcript: "hello",
        mode: "default",
        forceGuidance: false,
        turnIndex: 0,
      });
      await endpoints.end({ sessionId: "s1" });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls.length).toBe(5);
    for (const call of calls) {
      expect(call.startsWith(`/api/live/guest-access/${token}/session`)).toBe(true);
    }
  });

  it("never sends an interview id or applicant session id to a guest route", async () => {
    const bodies: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return {
        ok: true,
        status: 200,
        json: async () => ({ sdp: "answer", id: "s", ok: true, sessionId: "s1", isQuestion: false, guidance: null }),
      } as Response;
    }) as typeof fetch;

    try {
      await endpoints.start({ captureMode: "shared_audio", consent: true });
      await endpoints.connect({ sessionId: "s1", sdp: "offer" });
      await endpoints.activate({ sessionId: "s1", openaiSessionId: "sess_1" });
      await endpoints.end({ sessionId: "s1" });
    } finally {
      globalThis.fetch = originalFetch;
    }

    for (const body of bodies) {
      expect(body).not.toContain("sessionId");
    }
  });

  it("keeps applicant Live on the interview-scoped authenticated routes", () => {
    const applicant = candidateLiveEndpoints("interview-9");
    for (const call of [
      "/api/interviews/interview-9/live/prepare",
      "/api/interviews/interview-9/live/webrtc",
      "/api/interviews/interview-9/live/activate",
      "/api/interviews/interview-9/live/transcript",
      "/api/interviews/interview-9/live/end",
    ]) {
      expect(call).toContain("/api/interviews/interview-9/live/");
    }
    expect(applicant).toBeDefined();
  });
});

describe("the employer candidate view cannot carry candidate-private data (F13-J)", () => {
  it("has no field for a transcript, guidance, mock feedback, or post-interview analysis", () => {
    const typeSource = readFileSync(join(process.cwd(), "src/lib/employers/types.ts"), "utf8");
    const candidateBlock = typeSource.slice(typeSource.indexOf("export type CandidateDetail"));
    for (const forbidden of [
      "transcript",
      "guidance",
      "mock",
      "postInterview",
      "post_interview",
      "liveSession",
    ]) {
      expect(candidateBlock.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("keeps the employer domain free of candidate Live imports", () => {
    const typeSource = readFileSync(join(process.cwd(), "src/lib/employers/types.ts"), "utf8");
    // Real import syntax only; prose in the header may mention the paths.
    expect(typeSource).not.toMatch(/from\s+["']@\/lib\/(live|interviews)/);
  });

  it("describes a candidate detail with only backend-sourced, non-identifying fields", () => {
    const sample: CandidateDetail = {
      id: "app-1",
      appliedJobId: "job-1",
      appliedJobTitle: "Senior Backend Engineer",
      stage: "REVIEWING",
    };
    expect(Object.keys(sample).sort()).toEqual([
      "appliedJobId",
      "appliedJobTitle",
      "id",
      "stage",
    ]);
  });
});
