import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INTERVIEW_REMINDER_MINUTES,
  fireDueInterviewReminders,
  reminderTypeForMinutes,
} from "@/lib/notifications/reminders";
import { fakeQueryResult, fromRouter } from "../helpers/fake-supabase";

const createServiceClientMock = vi.fn();

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClientMock(),
}));

const USER = "11111111-1111-4111-8111-111111111111";
const INTERVIEW = "22222222-2222-4222-8222-222222222222";
const APPLICATION = "33333333-3333-4333-8333-333333333333";
const REMINDER_A = "44444444-4444-4444-8444-444444444444";
const REMINDER_B = "55555555-5555-4555-8555-555555555555";

function dueReminder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: REMINDER_A,
    user_id: USER,
    interview_id: INTERVIEW,
    reminder_type: "1_day",
    due_at: "2026-09-28T00:00:00.000Z",
    timezone: "America/New_York",
    ...overrides,
  };
}

describe("INTERVIEW_REMINDER_MINUTES", () => {
  it("mirrors the SQL reminder windows (1440 minutes / 60 minutes)", () => {
    expect([...INTERVIEW_REMINDER_MINUTES]).toEqual([1440, 60]);
  });
});

describe("reminderTypeForMinutes", () => {
  it("labels the two windows 1_day and 1_hour and falls back to minutes", () => {
    expect(reminderTypeForMinutes(1440)).toBe("1_day");
    expect(reminderTypeForMinutes(60)).toBe("1_hour");
    expect(reminderTypeForMinutes(90)).toBe("90_min");
  });
});

describe("fireDueInterviewReminders", () => {
  beforeEach(() => {
    createServiceClientMock.mockReset();
  });

  it("notifies once per due window and marks the reminders fired", async () => {
    createServiceClientMock.mockReturnValue({
      from: fromRouter({
        notification_reminders: [
          dueReminder(),
          dueReminder({ id: REMINDER_B, reminder_type: "1_hour" }),
        ],
        interviews: [
          {
            id: INTERVIEW,
            user_id: USER,
            application_id: APPLICATION,
            scheduled_at: "2026-09-29T12:00:00.000Z",
            timezone: "America/New_York",
            status: "scheduled",
          },
        ],
        applications: [{ id: APPLICATION, role_title: "Engineer", company_name: "Acme" }],
        notification_preferences: [{ user_id: USER, interview_reminders: true }],
        notifications: {
          id: "66666666-6666-4666-8666-666666666666",
          recipient_user_id: USER,
          recipient_type: "candidate",
          notification_type: "INTERVIEW_REMINDER",
          title: "Interview reminder",
          entity_type: "interview",
          entity_id: INTERVIEW,
          created_at: "2026-09-28T00:00:00.000Z",
          updated_at: "2026-09-28T00:00:00.000Z",
        },
      }),
    });

    const summary = await fireDueInterviewReminders();
    expect(summary).toEqual({
      fired: 2,
      notified: 2,
      skippedChannelOff: 0,
      skippedNotApplicable: 0,
    });
  });

  it("marks reminders fired without notifying when the channel is off", async () => {
    createServiceClientMock.mockReturnValue({
      from: fromRouter({
        notification_reminders: [dueReminder()],
        interviews: [{ id: INTERVIEW, status: "scheduled" }],
        applications: [],
        notification_preferences: [{ user_id: USER, interview_reminders: false }],
      }),
    });

    const summary = await fireDueInterviewReminders();
    expect(summary).toEqual({
      fired: 0,
      notified: 0,
      skippedChannelOff: 1,
      skippedNotApplicable: 0,
    });
  });

  it("clears stale reminders for cancelled or completed interviews", async () => {
    createServiceClientMock.mockReturnValue({
      from: fromRouter({
        notification_reminders: [dueReminder()],
        interviews: [{ id: INTERVIEW, status: "cancelled" }],
        applications: [],
        notification_preferences: [],
      }),
    });

    const summary = await fireDueInterviewReminders();
    expect(summary).toEqual({
      fired: 0,
      notified: 0,
      skippedChannelOff: 0,
      skippedNotApplicable: 1,
    });
  });

  it("clears a reminder whose interview no longer exists", async () => {
    createServiceClientMock.mockReturnValue({
      from: fromRouter({
        notification_reminders: [dueReminder()],
        interviews: [],
        applications: [],
        notification_preferences: [],
      }),
    });

    const summary = await fireDueInterviewReminders();
    expect(summary.fired).toBe(1);
    expect(summary.notified).toBe(0);
  });

  it("treats a replayed notification as fired but already-notified (dedupe)", async () => {
    const router = fromRouter({
      notification_reminders: [dueReminder()],
      interviews: [{ id: INTERVIEW, status: "scheduled" }],
      applications: [],
      notification_preferences: [],
    });
    createServiceClientMock.mockReturnValue({
      from: (table: string) =>
        table === "notifications"
          ? fakeQueryResult(null, { code: "23505", message: "duplicate key value" })
          : router(table),
    });

    const summary = await fireDueInterviewReminders();
    expect(summary).toEqual({
      fired: 1,
      notified: 0,
      skippedChannelOff: 0,
      skippedNotApplicable: 0,
    });
  });

  it("returns an empty summary when nothing is due", async () => {
    createServiceClientMock.mockReturnValue({
      from: fromRouter({ notification_reminders: [] }),
    });

    const summary = await fireDueInterviewReminders();
    expect(summary).toEqual({
      fired: 0,
      notified: 0,
      skippedChannelOff: 0,
      skippedNotApplicable: 0,
    });
  });
});