import { describe, expect, it } from "vitest";
import {
  CANDIDATE_NOTIFICATION_TYPES,
  CRITICAL_CANDIDATE_NOTIFICATION_TYPES,
  EMAIL_CAPABLE_NOTIFICATION_TYPES,
  EMPLOYER_NOTIFICATION_TYPES,
  NOTIFICATION_CATALOG,
  NOTIFICATION_TYPES,
  isCandidateType,
  isCriticalCandidateType,
  isEmailCapable,
  isEmployerType,
} from "@/lib/notifications/catalog";
import {
  EMPLOYER_NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNELS,
} from "@/lib/notifications/service";

describe("notification type catalog", () => {
  it("names at least the 24 candidate and 11 employer types the 2K spec requires", () => {
    expect(CANDIDATE_NOTIFICATION_TYPES).toHaveLength(24);
    expect(EMPLOYER_NOTIFICATION_TYPES).toHaveLength(11);
    expect(NOTIFICATION_TYPES).toHaveLength(35);
  });

  it("covers every type exactly once, with no duplicates", () => {
    expect(new Set(NOTIFICATION_TYPES).size).toBe(NOTIFICATION_TYPES.length);
  });

  it("keeps candidate and employer vocabularies disjoint", () => {
    const candidates = new Set<string>(CANDIDATE_NOTIFICATION_TYPES);
    const employers = new Set<string>(EMPLOYER_NOTIFICATION_TYPES);
    for (const type of candidates) expect(employers.has(type)).toBe(false);
    for (const type of employers) expect(candidates.has(type)).toBe(false);
  });

  it("assigns every type a recipient, a channel, a priority and a phase", () => {
    for (const type of NOTIFICATION_TYPES) {
      const meta = NOTIFICATION_CATALOG[type];
      expect(["candidate", "employer_member"]).toContain(meta.recipient);
      expect(meta.priority).toMatch(/^(normal|high|urgent)$/);
      expect(meta.phase.length).toBeGreaterThan(0);
      expect(typeof meta.email).toBe("boolean");
    }
  });

  it("maps candidate types onto candidate channels and employer types onto org channels only", () => {
    for (const type of CANDIDATE_NOTIFICATION_TYPES) {
      expect(isCandidateType(type)).toBe(true);
      expect(isEmployerType(type)).toBe(false);
      expect(NOTIFICATION_CHANNELS).toContain(NOTIFICATION_CATALOG[type].channel);
    }
    for (const type of EMPLOYER_NOTIFICATION_TYPES) {
      expect(isEmployerType(type)).toBe(true);
      expect(isCandidateType(type)).toBe(false);
      expect(EMPLOYER_NOTIFICATION_CHANNELS).toContain(NOTIFICATION_CATALOG[type].channel);
    }
  });

  it("flags exactly the critical candidate set: the five blocker/funds types", () => {
    const critical = new Set(
      NOTIFICATION_TYPES.filter((type) => isCriticalCandidateType(type))
    );
    expect([...critical].sort()).toEqual(
      [
        "APPLICATION_CAPTCHA_REQUIRED",
        "APPLICATION_MANUAL_ACTION_REQUIRED",
        "APPLICATION_MFA_REQUIRED",
        "APPLICATION_SENSITIVE_QUESTION",
        "WALLET_LOW_BALANCE",
      ].sort()
    );
    expect(CRITICAL_CANDIDATE_NOTIFICATION_TYPES.size).toBe(5);
  });

  it("has no employer type marked critical", () => {
    for (const type of EMPLOYER_NOTIFICATION_TYPES) {
      expect(NOTIFICATION_CATALOG[type].critical).toBeUndefined();
    }
  });

  it("treats every cataloged type as email-capable in 2K (switch still applies)", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(isEmailCapable(type)).toBe(true);
      expect(EMAIL_CAPABLE_NOTIFICATION_TYPES.has(type)).toBe(true);
    }
  });

  it("marks the deferred guest/premium types explicitly catalog-only in their phase", () => {
    for (const type of [
      "PREMIUM_INTERVIEW_EXPIRING",
      "GUEST_ACCESS_CREATED",
      "GUEST_ACCESS_ACTIVATED",
      "GUEST_ACCESS_COMPLETED",
      "GUEST_ACCESS_REVOKED",
    ] as const) {
      expect(NOTIFICATION_CATALOG[type].phase).toMatch(/catalog-only/);
    }
  });

  it("marks the 2N-wired premium purchase/renewal types as wired", () => {
    expect(NOTIFICATION_CATALOG.PREMIUM_INTERVIEW_PURCHASED.phase).toMatch(/wired/);
    expect(NOTIFICATION_CATALOG.PREMIUM_INTERVIEW_RENEWAL.phase).toMatch(/wired/);
  });

  it("marks the 2R-wired employer fit/pipeline types as wired", () => {
    expect(NOTIFICATION_CATALOG.EMPLOYER_STRONG_FIT.phase).toMatch(/wired/);
    expect(NOTIFICATION_CATALOG.EMPLOYER_PIPELINE_UPDATED.phase).toMatch(/wired/);
  });

  it("marks the 2S-wired employer interview/seat/featured types as wired", () => {
    expect(NOTIFICATION_CATALOG.EMPLOYER_INTERVIEW_EVENT.phase).toMatch(/wired/);
    expect(NOTIFICATION_CATALOG.EMPLOYER_RECRUITER_SEAT_WARNING.phase).toMatch(/wired/);
    expect(NOTIFICATION_CATALOG.EMPLOYER_FEATURED_JOB_EXPIRING.phase).toMatch(/wired/);
    expect(NOTIFICATION_CATALOG.EMPLOYER_FEATURED_JOB_EXPIRED.phase).toMatch(/wired/);
  });

  it("keeps the strong-match type marked wired and the product type marketing-gated", () => {
    expect(NOTIFICATION_CATALOG.JOB_STRONG_MATCH.phase).toMatch(/wired/);
    expect(NOTIFICATION_CATALOG.PRODUCT_UPDATE.phase).toMatch(/product channel/);
  });
});