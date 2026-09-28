import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_EMAIL_LOG_PREFIX,
  WALLET_LOW_THRESHOLD_CENTS,
  buildNotificationEmail,
  planNotificationEmailActions,
  recipientPreferenceKey,
  type NotificationEmailAction,
} from "@/lib/notifications/email";
import type { NotificationRow } from "@/lib/notifications/records";

const USER = "11111111-1111-4111-8111-111111111111";
const CANDIDATE_MSG = "Your wallet balance is running low";

function candidateRow(overrides: Partial<NotificationRow> = {}): NotificationRow {
  const base: NotificationRow = {
    id: "33333333-3333-4333-8333-333333333333",
    recipient_user_id: USER,
    recipient_type: "candidate",
    organization_id: null,
    notification_type: "WALLET_LOW_BALANCE",
    title: "Your wallet balance is running low",
    message: CANDIDATE_MSG,
    entity_type: "credit_transaction",
    entity_id: "44444444-4444-4444-8444-444444444444",
    action_url: "/billing",
    priority: "high",
    read_at: null,
    email_delivery_status: "none",
    expires_at: null,
    metadata: {},
    dedupe_key: null,
    created_at: "2026-09-28T00:00:00.000Z",
  };
  return { ...base, ...overrides };
}

function enqueued(actions: NotificationEmailAction[]): NotificationEmailAction[] {
  return actions.filter((a) => a.kind === "enqueue");
}

describe("notification email constants", () => {
  it("pins the $5.00 low-balance threshold that mirrors the SQL constant", () => {
    expect(WALLET_LOW_THRESHOLD_CENTS).toBe(500);
  });

  it("uses a recognizable log prefix", () => {
    expect(NOTIFICATION_EMAIL_LOG_PREFIX).toBe("[ODESSEUS_NOTIFICATION_EMAIL]");
  });
});

describe("recipientPreferenceKey", () => {
  it("keys candidate preferences on the user and employer on the org", () => {
    expect(recipientPreferenceKey("candidate", null)).toBe("candidate");
    expect(recipientPreferenceKey("employer_member", "22222222-2222-4222-8222-222222222222")).toBe(
      "employer:22222222-2222-4222-8222-222222222222"
    );
  });
});

describe("buildNotificationEmail", () => {
  it("fills the subject, heading and body from the row", () => {
    const draft = buildNotificationEmail(candidateRow());
    expect(draft.subject).toBe(`Odesseus: ${CANDIDATE_MSG}`);
    expect(draft.heading).toBe(CANDIDATE_MSG);
    expect(draft.body).toBe(CANDIDATE_MSG);
    expect(draft.ctaLabel).toBe("View details");
    expect(draft.ctaHref).toBe("/billing");
  });

  it("degrades a missing message with a calm default instead of an empty paragraph", () => {
    const draft = buildNotificationEmail(candidateRow({ message: null }));
    expect(draft.body).toBe("See your notification in Odesseus.");
  });

  it("omits the CTA when there is no action url", () => {
    const draft = buildNotificationEmail(candidateRow({ action_url: null }));
    expect(draft.ctaLabel).toBeUndefined();
    expect(draft.ctaHref).toBeUndefined();
  });
});

describe("planNotificationEmailActions", () => {
  it("enqueues an email for a wanted row with a resolved address", () => {
    const actions = planNotificationEmailActions(
      [candidateRow()],
      { [USER]: true },
      {},
      { [USER]: "candidate@example.com" }
    );
    expect(actions).toEqual([
      { kind: "enqueue", notification: candidateRow(), to: "candidate@example.com" },
    ]);
  });

  it("skips when the recipient email switch is off (in-app rows unaffected)", () => {
    const actions = planNotificationEmailActions(
      [candidateRow()],
      { [USER]: false },
      {},
      { [USER]: "candidate@example.com" }
    );
    expect(actions).toEqual([
      { kind: "skip", notification: candidateRow(), reason: "unwanted" },
    ]);
  });

  it("skips when the org email switch is off for employer rows", () => {
    const actions = planNotificationEmailActions(
      [
        candidateRow({
          recipient_type: "employer_member",
          organization_id: "22222222-2222-4222-8222-222222222222",
        }),
      ],
      {},
      { "22222222-2222-4222-8222-222222222222": false },
      { [USER]: "recruiter@example.com" }
    );
    expect(actions[0]).toMatchObject({ kind: "skip", reason: "unwanted" });
  });

  it("skips when the preferenceless recipient defaults are falsy", () => {
    const actions = planNotificationEmailActions(
      [candidateRow()],
      { [USER]: false },
      {},
      { [USER]: "x@example.com" }
    );
    expect(enqueued(actions)).toHaveLength(0);
  });

  it("skips when no address can be resolved", () => {
    const actions = planNotificationEmailActions(
      [candidateRow()],
      { [USER]: true },
      {},
      { [USER]: null }
    );
    expect(actions).toEqual([
      { kind: "skip", notification: candidateRow(), reason: "no_address" },
    ]);
  });

  it("defaults a missing preference row to email on", () => {
    const actions = planNotificationEmailActions(
      [candidateRow()],
      {},
      {},
      { [USER]: "candidate@example.com" }
    );
    expect(enqueued(actions)).toHaveLength(1);
  });

  it("enqueues critical and marketing types alike when wanted (catalog decides capability)", () => {
    const actions = planNotificationEmailActions(
      [
        candidateRow({ notification_type: "APPLICATION_CAPTCHA_REQUIRED" }),
        candidateRow({
          id: "33333333-3333-4333-8333-222222222222",
          notification_type: "GUEST_ACCESS_CREATED",
        }),
      ],
      { [USER]: true },
      {},
      { [USER]: "candidate@example.com" }
    );
    expect(enqueued(actions)).toHaveLength(2);
  });

  it("skips a row whose type is not in the catalog, even with email on", () => {
    const rogue = {
      ...candidateRow(),
      notification_type: "SOME_LEGACY_TYPE",
    } as unknown as NotificationRow;
    const actions = planNotificationEmailActions(
      [rogue],
      { [USER]: true },
      {},
      { [USER]: "candidate@example.com" }
    );
    expect(actions).toEqual([
      { kind: "skip", notification: rogue, reason: "unwanted" },
    ]);
  });
});