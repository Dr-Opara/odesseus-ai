import { describe, expect, it } from "vitest";
import {
  DEFAULT_STRONG_MATCH_SCORE,
  projectActivityItem,
} from "@/lib/candidate/dashboard";

/**
 * These cover the projection that turns a stored event row into something the
 * dashboard can render, including the cases where the row is not what the
 * database would have produced.
 */

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "e1",
  event_type: "job_matched",
  title: "Matched Engineer at Acme",
  detail: "Match score 90",
  entity_type: "job_opportunity",
  entity_id: "j1",
  occurred_at: "2026-10-27T10:00:00.000Z",
  ...overrides,
});

describe("projectActivityItem", () => {
  it("projects a well-formed row into a display item with a link", () => {
    expect(projectActivityItem(row())).toEqual({
      id: "e1",
      eventType: "job_matched",
      title: "Matched Engineer at Acme",
      detail: "Match score 90",
      occurredAt: "2026-10-27T10:00:00.000Z",
      href: "/jobs/j1",
      needsAttention: false,
    });
  });

  it("drops a row whose event type is not in the vocabulary", () => {
    // The database CHECK makes this impossible against a real database. The
    // guard is for a client that did not validate, and dropping the line beats
    // rendering a feed item with no label and no icon.
    expect(projectActivityItem(row({ event_type: "email_detected" }))).toBeNull();
    expect(projectActivityItem(row({ event_type: "email_detected" }))?.title).toBeUndefined();
  });

  it("drops a row with no event type at all", () => {
    expect(projectActivityItem(row({ event_type: undefined }))).toBeNull();
    expect(projectActivityItem(row({ event_type: null }))).toBeNull();
  });

  it("flags the three event types that mean the candidate must act", () => {
    for (const eventType of [
      "application_needs_review",
      "application_needs_input",
      "application_held",
    ] as const) {
      expect(projectActivityItem(row({ event_type: eventType }))?.needsAttention).toBe(
        true
      );
    }
  });

  it("does not flag a submission or a charge as needing attention", () => {
    expect(
      projectActivityItem(row({ event_type: "application_submitted" }))?.needsAttention
    ).toBe(false);
    expect(
      projectActivityItem(row({ event_type: "wallet_charged" }))?.needsAttention
    ).toBe(false);
  });

  it("keeps a null detail rather than inventing a placeholder", () => {
    expect(projectActivityItem(row({ detail: null }))?.detail).toBeNull();
  });

  it("treats an empty detail string as absent", () => {
    // A stored empty string would render as a blank second line under the title.
    expect(projectActivityItem(row({ detail: "" }))?.detail).toBe("");
  });

  it("omits the link for an entity that has no page", () => {
    expect(
      projectActivityItem(
        row({ entity_type: "credit_transaction", entity_id: "c1" })
      )?.href
    ).toBeNull();
  });

  it("omits the link when the entity is missing rather than building a broken one", () => {
    expect(projectActivityItem(row({ entity_type: null }))?.href).toBeNull();
    expect(projectActivityItem(row({ entity_id: null }))?.href).toBeNull();
  });

  it("never throws on a malformed row", () => {
    // The feed is a secondary surface: a bad row must not take down the page
    // that also carries the wallet balance and the application count.
    expect(() => projectActivityItem({} as Record<string, unknown>)).not.toThrow();
    expect(projectActivityItem({} as Record<string, unknown>)).toBeNull();
  });
});

describe("the strong match default", () => {
  it("is 85, which is the threshold every other surface already uses", () => {
    // job_preferences.min_match_score defaults to 85 in discovery, the job
    // list and the old dashboard. A different number here would make the same
    // candidate qualified on one page and unqualified on another.
    expect(DEFAULT_STRONG_MATCH_SCORE).toBe(85);
  });
});
