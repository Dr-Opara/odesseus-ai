import { describe, expect, it } from "vitest";
import {
  canStartLive,
  createTurnSequencer,
  hasLiveEntitlement,
  type LiveEntitlementGate,
} from "@/lib/live/session-state";

/** An applicant spending their own passes. */
const passes = (available: number): LiveEntitlementGate => ({
  kind: "passes",
  available,
});

describe("hasLiveEntitlement", () => {
  it("admits an applicant who has at least one pass", () => {
    expect(hasLiveEntitlement(passes(1))).toBe(true);
    expect(hasLiveEntitlement(passes(5))).toBe(true);
  });

  it("refuses an applicant with no passes", () => {
    expect(hasLiveEntitlement(passes(0))).toBe(false);
  });

  it("admits a guest whose session is covered by the link owner's plan", () => {
    // A guest has no account, no wallet, and no passes. Refusing them here
    // would leave the Start button permanently disabled, which is the bug
    // this type exists to prevent.
    expect(hasLiveEntitlement({ kind: "included" })).toBe(true);
  });
});

describe("canStartLive", () => {
  it("allows starting from idle with consent and an available pass", () => {
    expect(canStartLive("idle", true, passes(1))).toBe(true);
  });

  it("allows retrying from the error state without a page refresh", () => {
    // This is the exact bug the audit flagged: retry must not be blocked
    // by an idle-only gate, since the button is shown in both idle and
    // error states.
    expect(canStartLive("error", true, passes(1))).toBe(true);
  });

  it("refuses to start without consent, regardless of state", () => {
    expect(canStartLive("idle", false, passes(1))).toBe(false);
    expect(canStartLive("error", false, passes(1))).toBe(false);
  });

  it("refuses an applicant with zero interview passes", () => {
    expect(canStartLive("idle", true, passes(0))).toBe(false);
  });

  it("refuses to start while already connecting, live, or ending", () => {
    expect(canStartLive("connecting", true, passes(1))).toBe(false);
    expect(canStartLive("live", true, passes(1))).toBe(false);
    expect(canStartLive("ending", true, passes(1))).toBe(false);
  });

  it("refuses to start once the session has already ended", () => {
    expect(canStartLive("ended", true, passes(1))).toBe(false);
  });

  describe("for a guest covered by the link owner's plan", () => {
    it("still requires consent", () => {
      // Consent is the one thing a guest cannot inherit from the owner. It is
      // the guest's own audio and their own permission to record it.
      expect(canStartLive("idle", false, { kind: "included" })).toBe(false);
      expect(canStartLive("error", false, { kind: "included" })).toBe(false);
      expect(canStartLive("idle", true, { kind: "included" })).toBe(true);
    });

    it("obeys the same state machine as an applicant", () => {
      expect(canStartLive("connecting", true, { kind: "included" })).toBe(false);
      expect(canStartLive("live", true, { kind: "included" })).toBe(false);
      expect(canStartLive("ending", true, { kind: "included" })).toBe(false);
      expect(canStartLive("ended", true, { kind: "included" })).toBe(false);
      expect(canStartLive("error", true, { kind: "included" })).toBe(true);
    });
  });
});

describe("createTurnSequencer", () => {
  it("assigns increasing indexes in first-seen order", () => {
    const sequencer = createTurnSequencer();
    expect(sequencer.turnIndexFor("item-a")).toBe(0);
    expect(sequencer.turnIndexFor("item-b")).toBe(1);
    expect(sequencer.turnIndexFor("item-c")).toBe(2);
  });

  it("returns the same index for the same item on repeated calls", () => {
    const sequencer = createTurnSequencer();
    const first = sequencer.turnIndexFor("item-a");
    expect(sequencer.turnIndexFor("item-a")).toBe(first);
    expect(sequencer.turnIndexFor("item-a")).toBe(first);
  });

  it("locks in order from first observation, not from completion order", () => {
    // Simulates: item A's delta arrives first (so it should keep the
    // earlier turn index) even though item B's completion event happens
    // to be handled first.
    const sequencer = createTurnSequencer();
    sequencer.turnIndexFor("item-a"); // A's delta seen first
    sequencer.turnIndexFor("item-b"); // B's delta seen second

    // B completes first over the wire — its index was already locked in
    // by the earlier delta observation, so it stays after A.
    expect(sequencer.turnIndexFor("item-b")).toBe(1);
    expect(sequencer.turnIndexFor("item-a")).toBe(0);
  });

  it("peek returns undefined for an item that has never been observed", () => {
    const sequencer = createTurnSequencer();
    expect(sequencer.peek("never-seen")).toBeUndefined();
    sequencer.turnIndexFor("now-seen");
    expect(sequencer.peek("now-seen")).toBe(0);
  });

  it("keeps independent sequences across separate sequencer instances", () => {
    const a = createTurnSequencer();
    const b = createTurnSequencer();
    a.turnIndexFor("x");
    a.turnIndexFor("y");
    expect(b.turnIndexFor("z")).toBe(0);
  });
});
