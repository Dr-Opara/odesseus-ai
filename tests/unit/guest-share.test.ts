import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GUEST_SHARE_SOURCE,
  NON_GUEST_INTERVIEW_FILTER,
  buildGuestLiveContext,
  canGenerateGuestLinks,
  generateGuestLinkToken,
  guestTokenBucket,
  hashGuestLinkToken,
  isGuestShareInterview,
  isPlausibleGuestLinkToken,
  type GuestAccessRecord,
} from "@/lib/interviews/guest-share";

const BASE_ENTITLEMENT = {
  has_access: true,
  source: "membership",
  plan: "monthly",
  sessions_remaining: 20,
  period_end: null,
  is_owner: false,
  is_guest: false,
  membership_id: "mem-1",
  guest_limit: 0,
  activated_guest_count: 0,
} as const;

function guestRecord(): GuestAccessRecord {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    owner_user_id: "user-owner",
    token_sha256: "digest",
    guest_name: "Guest User",
    guest_company: "Acme",
    guest_role_title: "Engineer",
    guest_job_description: "Build things.",
    guest_resume_text: null,
    guest_resume_storage_path: null,
    guest_resume_profile: null,
    guest_interview_type: "behavioral",
    guest_round: "2",
    guest_notes: "Second round.",
    interview_id: "22222222-2222-4222-8222-222222222222",
    live_session_id: "11111111-1111-4111-8111-111111111111",
    status: "active",
    activated_at: "2026-01-01T00:00:00Z",
    completed_at: null,
    cancelled_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("guest link tokens (2O)", () => {
  it("mints 256-bit hex tokens", () => {
    const a = generateGuestLinkToken();
    const b = generateGuestLinkToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("hashes deterministically with SHA-256 and never embeds the token", () => {
    const token = "ab".repeat(32);
    expect(hashGuestLinkToken(token)).toBe(
      createHash("sha256").update(token, "utf8").digest("hex")
    );
    expect(hashGuestLinkToken(token)).not.toContain(token);
  });

  it("rejects malformed tokens before any database work", () => {
    expect(isPlausibleGuestLinkToken("ab".repeat(32))).toBe(true);
    expect(isPlausibleGuestLinkToken("not-a-token")).toBe(false);
    expect(isPlausibleGuestLinkToken("")).toBe(false);
    expect(isPlausibleGuestLinkToken("ab".repeat(31))).toBe(false);
  });

  it("buckets rate limits by token hash, never the raw token", () => {
    const token = "ab".repeat(32);
    const bucket = guestTokenBucket(token, "setup");
    expect(bucket).toContain(hashGuestLinkToken(token).slice(0, 16));
    expect(bucket).not.toContain(token);
  });
});

describe("Share Annual link gate (2O)", () => {
  it("admits only active Share Annual owners", () => {
    expect(
      canGenerateGuestLinks({ ...BASE_ENTITLEMENT, plan: "share_annual", is_owner: true })
    ).toBe(true);
    expect(canGenerateGuestLinks({ ...BASE_ENTITLEMENT })).toBe(false);
    expect(
      canGenerateGuestLinks({ ...BASE_ENTITLEMENT, plan: "share_annual", is_owner: false })
    ).toBe(false);
    expect(
      canGenerateGuestLinks({
        ...BASE_ENTITLEMENT,
        plan: "share_annual",
        is_owner: true,
        has_access: false,
      })
    ).toBe(false);
    expect(
      canGenerateGuestLinks({
        ...BASE_ENTITLEMENT,
        source: "guest",
        plan: "guest",
        is_guest: true,
      })
    ).toBe(false);
  });
});

describe("guest interview marking (2O)", () => {
  it("identifies guest-share rows by source", () => {
    expect(isGuestShareInterview({ source: GUEST_SHARE_SOURCE })).toBe(true);
    expect(isGuestShareInterview({ source: "manual" })).toBe(false);
    expect(isGuestShareInterview({ source: null })).toBe(false);
  });

  it("exposes a null-safe exclusion filter for candidate reads", () => {
    expect(NON_GUEST_INTERVIEW_FILTER).toContain("guest_share_link");
    expect(NON_GUEST_INTERVIEW_FILTER).toContain("is.null");
  });
});

describe("guest Live context (2O)", () => {
  it("contains only guest data in the applicant Live shape", () => {
    const context = buildGuestLiveContext({
      record: guestRecord(),
      interview: { id: "22222222-2222-4222-8222-222222222222", status: "active", interview_type: null },
    });

    expect(context.interview.source).toBe(GUEST_SHARE_SOURCE);
    expect(context.interview.company).toBe("Acme");
    expect(context.candidate.fullName).toBe("Guest User");
    expect(context.application.id).toBeNull();
    expect(context.application.companyName).toBe("Acme");
    expect(context.application.jobSnapshot).toEqual({ description: "Build things." });
    expect(context.priorRounds).toEqual([]);
    expect(context.mockSessionsReady).toBe(false);

    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain("user-owner");
  });
});
