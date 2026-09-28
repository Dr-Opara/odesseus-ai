import { describe, expect, it } from "vitest";
import {
  CANDIDATE_ACTIVITY_ATTENTION_TYPES,
  CANDIDATE_ACTIVITY_ENTITY_TYPES,
  CANDIDATE_ACTIVITY_EVENT_TYPES,
  CANDIDATE_ACTIVITY_MILESTONE_TYPES,
  CANDIDATE_ACTIVITY_WALLET_TYPES,
  candidateActivityHref,
  isCandidateActivityAttention,
  isCandidateActivityEventType,
  isCandidateActivityMilestone,
  type CandidateActivityEventType,
} from "@/lib/candidate/activity";

describe("the candidate activity vocabulary", () => {
  it("is the seventeen events Phase 2J names, with no invented values", () => {
    // Written out in full rather than asserted against a count, so that adding
    // or renaming a value has to be a deliberate edit here. A count assertion
    // would pass just as happily on a list with the wrong seventeen entries.
    expect([...CANDIDATE_ACTIVITY_EVENT_TYPES]).toEqual([
      "job_matched",
      "job_saved",
      "resume_uploaded",
      "resume_optimized",
      "application_queued",
      "application_needs_review",
      "application_needs_input",
      "application_held",
      "application_submitted",
      "application_verified",
      "application_failed",
      "interview_added",
      "mock_interview_completed",
      "wallet_charged",
      "wallet_topped_up",
      "agent_paused",
      "agent_resumed",
    ]);
  });

  it("contains no duplicates, which would make a switch unreachable", () => {
    expect(new Set(CANDIDATE_ACTIVITY_EVENT_TYPES).size).toBe(
      CANDIDATE_ACTIVITY_EVENT_TYPES.length
    );
  });

  it("holds no empty or oddly-cased value", () => {
    for (const type of CANDIDATE_ACTIVITY_EVENT_TYPES) {
      expect(type).toMatch(/^[a-z][a-z_]*$/);
    }
  });
});

describe("isCandidateActivityEventType", () => {
  it("accepts every value in the vocabulary", () => {
    for (const type of CANDIDATE_ACTIVITY_EVENT_TYPES) {
      expect(isCandidateActivityEventType(type)).toBe(true);
    }
  });

  it("rejects an integration-derived type that the database would also reject", () => {
    // The dashboard's whole premise is that it does not read mailbox data, so
    // these two values must never become acceptable here. Both are real values
    // of application_status_events.event_type, which is exactly the table this
    // vocabulary exists to stop depending on.
    expect(isCandidateActivityEventType("email_detected")).toBe(false);
    expect(isCandidateActivityEventType("calendar_detected")).toBe(false);
    expect(isCandidateActivityEventType("offer_detected")).toBe(false);
  });

  it("rejects values that only look right", () => {
    expect(isCandidateActivityEventType("Job_Matched")).toBe(false);
    expect(isCandidateActivityEventType(" job_matched")).toBe(false);
    expect(isCandidateActivityEventType("job matched")).toBe(false);
    expect(isCandidateActivityEventType("")).toBe(false);
  });

  it("rejects non-strings rather than coercing them", () => {
    // A number 3 is not a job_matched. A guard that stringified its input would
    // let a malformed row through the type system and then render nothing.
    for (const value of [null, undefined, 3, {}, [], true, Symbol("job_matched")]) {
      expect(isCandidateActivityEventType(value)).toBe(false);
    }
  });
});

describe("the derived groupings", () => {
  const members = (list: readonly CandidateActivityEventType[]) => new Set(list);

  it("routes every event that needs the candidate to act to the attention list", () => {
    // The obligation and the record of it are written by the same trigger, so
    // they cannot drift apart the way a re-derived flag would.
    expect([...CANDIDATE_ACTIVITY_ATTENTION_TYPES].sort()).toEqual(
      ["application_held", "application_needs_input", "application_needs_review"].sort()
    );
  });

  it("does not treat a submitted or charged event as needing attention", () => {
    // A feed that claimed every line needed action would be a to-do list of
    // things already done.
    for (const type of [
      "application_submitted",
      "application_verified",
      "wallet_charged",
      "job_saved",
    ] as const) {
      expect(members(CANDIDATE_ACTIVITY_ATTENTION_TYPES).has(type)).toBe(false);
      expect(isCandidateActivityAttention(type)).toBe(false);
    }
  });

  it("treats a held application as needing attention, because a CAPTCHA waits on them", () => {
    expect(isCandidateActivityAttention("application_held")).toBe(true);
  });

  it("marks only progress events as milestones", () => {
    expect([...CANDIDATE_ACTIVITY_MILESTONE_TYPES].sort()).toEqual(
      [
        "application_submitted",
        "application_verified",
        "interview_added",
        "mock_interview_completed",
      ].sort()
    );
    expect(isCandidateActivityMilestone("wallet_charged")).toBe(false);
    expect(isCandidateActivityMilestone("application_queued")).toBe(false);
  });

  it("keeps the wallet list to the two movements of the wallet itself", () => {
    // A Live pass is billed separately from the wallet, and an operator
    // adjustment never reaches the candidate's feed at all.
    expect([...CANDIDATE_ACTIVITY_WALLET_TYPES].sort()).toEqual(
      ["wallet_charged", "wallet_topped_up"].sort()
    );
  });

  it("keeps the four groupings disjoint, so no event is described twice", () => {
    const groups = [
      CANDIDATE_ACTIVITY_ATTENTION_TYPES,
      CANDIDATE_ACTIVITY_MILESTONE_TYPES,
      CANDIDATE_ACTIVITY_WALLET_TYPES,
    ];
    const seen = new Set<CandidateActivityEventType>();
    for (const group of groups) {
      for (const type of group) {
        expect(seen.has(type)).toBe(false);
        seen.add(type);
      }
    }
  });

  it("uses only values from the vocabulary in every grouping", () => {
    for (const group of [
      CANDIDATE_ACTIVITY_ATTENTION_TYPES,
      CANDIDATE_ACTIVITY_MILESTONE_TYPES,
      CANDIDATE_ACTIVITY_WALLET_TYPES,
    ]) {
      for (const type of group) {
        expect(isCandidateActivityEventType(type)).toBe(true);
      }
    }
  });
});

describe("candidateActivityHref", () => {
  it("routes each linkable entity to the page that owns it", () => {
    expect(candidateActivityHref("job_opportunity", "j1")).toBe("/jobs/j1");
    expect(candidateActivityHref("resume", "r1")).toBe("/settings/documents");
    expect(candidateActivityHref("resume_tailoring", "t1")).toBe(
      "/resume-tailoring/t1"
    );
    expect(candidateActivityHref("application_run", "a1")).toBe("/applications/a1");
    expect(candidateActivityHref("application", "a2")).toBe("/applications/a2");
    expect(candidateActivityHref("interview", "i1")).toBe("/interviews/i1");
  });

  it("returns null rather than a broken link where there is no page", () => {
    // A pause line is useful without a link. Inventing a route to make the
    // function total would produce a 404 the candidate clicks.
    expect(candidateActivityHref("credit_transaction", "c1")).toBeNull();
    expect(candidateActivityHref("application_agent_settings", "u1")).toBeNull();
  });

  it("covers every entity type the database can store", () => {
    for (const entityType of CANDIDATE_ACTIVITY_ENTITY_TYPES) {
      // The return type is string | null for exactly this reason: an entity
      // type with no decided destination is allowed, but the switch above is
      // exhaustive, so adding one forces this test to fail.
      const href = candidateActivityHref(entityType, "x");
      expect(href === null || href.startsWith("/")).toBe(true);
    }
  });
});
