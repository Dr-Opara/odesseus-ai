import { describe, expect, it } from "vitest";
import {
  createNotification,
  createNotificationOnce,
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  type NotificationRow,
} from "@/lib/notifications/records";
import { fakeAuthedClient, fakeQueryResult } from "../helpers/fake-supabase";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

function row(overrides: Partial<NotificationRow> = {}): NotificationRow {
  // The feed only depends on id, created_at and org scoping for paging;
  // the rest are filler that the service passes through untouched.
  const base: NotificationRow = {
    id: "33333333-3333-4333-8333-333333333333",
    recipient_user_id: USER,
    recipient_type: "candidate",
    organization_id: null,
    notification_type: "JOB_STRONG_MATCH",
    title: "t",
    message: null,
    entity_type: "job_opportunity",
    entity_id: "44444444-4444-4444-8444-444444444444",
    action_url: null,
    priority: "normal",
    read_at: null,
    email_delivery_status: "none",
    expires_at: null,
    metadata: {},
    dedupe_key: null,
    created_at: "2026-09-28T00:00:00.000Z",
  };
  return { ...base, ...overrides };
}

describe("listNotifications", () => {
  it("pages newest-first with a strictly-older cursor, capped at 50", async () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      row({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` })
    );
    for (let i = 0; i < rows.length; i += 1) {
      rows[i].created_at = new Date(Date.UTC(2026, 8, 28 - i)).toISOString();
    }
    const client = fakeAuthedClient({ from: () => fakeQueryResult(rows) });

    const page = await listNotifications(client as never, USER, { limit: 25 });
    expect(page.items).toHaveLength(25);
    expect(page.nextCursor).toBe(rows[24].created_at);

    // A requested page size above the cap is clamped to 50, still paged.
    const capped = await listNotifications(client as never, USER, { limit: 100 });
    expect(capped.items).toHaveLength(50);
    expect(capped.nextCursor).toBe(rows[49].created_at);

    // A feed shorter than the page has no next page.
    const exhausted = fakeAuthedClient({ from: () => fakeQueryResult(rows.slice(0, 10)) });
    const last = await listNotifications(exhausted as never, USER, { before: rows[0].created_at });
    expect(last.items).toHaveLength(10);
    expect(last.nextCursor).toBeNull();
  });

  it("filters by org, unread and type, and threads before together", async () => {
    const client = fakeAuthedClient({ from: () => fakeQueryResult([]) });
    const page = await listNotifications(client as never, USER, {
      limit: 10,
      unreadOnly: true,
      type: "APPLICATION_SUBMITTED",
      before: "2026-09-27T00:00:00.000Z",
      organizationId: ORG,
    });
    expect(page.items).toEqual([]);
    const calls = (
      client.from as unknown as { mock: { calls: Array<Array<unknown>> } }
    ).mock.calls.map((c) => String(c[0]));
    expect(calls).toContain("notifications");
  });

  it("surfaces a read error", async () => {
    const client = fakeAuthedClient({
      from: () => fakeQueryResult(null, { message: "boom" }),
    });
    await expect(listNotifications(client as never, USER)).rejects.toThrow(/Could not load notifications/);
  });
});

describe("getUnreadNotificationCount", () => {
  it("uses the exact head count when present", async () => {
    const client = fakeAuthedClient({ from: () => fakeQueryResult([], null, 7) });
    expect(await getUnreadNotificationCount(client as never, USER)).toBe(7);
  });

  it("falls back to the returned rows when the count is absent", async () => {
    const client = fakeAuthedClient({ from: () => fakeQueryResult([row(), row()]) });
    expect(await getUnreadNotificationCount(client as never, USER)).toBe(2);
  });

  it("surfaces a read error", async () => {
    const client = fakeAuthedClient({
      from: () => fakeQueryResult(null, { message: "nope" }),
    });
    await expect(getUnreadNotificationCount(client as never, USER)).rejects.toThrow(/unread/);
  });
});

describe("markNotificationsRead / markAllNotificationsRead", () => {
  it("marks a non-empty id list read", async () => {
    const client = fakeAuthedClient({ from: () => fakeQueryResult(null) });
    await markNotificationsRead(client as never, USER, ["33333333-3333-4333-8333-333333333333"]);
    const calls = (client.from as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.length).toBe(1);
  });

  it("does nothing for an empty id list", async () => {
    const client = fakeAuthedClient({ from: () => fakeQueryResult(null) });
    await markNotificationsRead(client as never, USER, []);
    expect(
      (client.from as unknown as { mock: { calls: unknown[][] } }).mock.calls
    ).toHaveLength(0);
  });

  it("marks everything unread read, org-scoped when asked", async () => {
    const client = fakeAuthedClient({ from: () => fakeQueryResult(null) });
    await markAllNotificationsRead(client as never, USER, { organizationId: ORG });
    expect(
      (client.from as unknown as { mock: { calls: unknown[][] } }).mock.calls
    ).toHaveLength(1);
  });

  it("surfaces write errors", async () => {
    const client = fakeAuthedClient({
      from: () => fakeQueryResult(null, { message: "permission denied" }),
    });
    await expect(
      markNotificationsRead(client as never, USER, ["33333333-3333-4333-8333-333333333333"])
    ).rejects.toThrow(/mark notifications read/);
  });
});

describe("createNotification / createNotificationOnce", () => {
  const input = {
    recipient_user_id: USER,
    recipient_type: "candidate" as const,
    notification_type: "INTERVIEW_REMINDER" as const,
    title: "Interview reminder",
    entity_type: "interview" as const,
    entity_id: "55555555-5555-4555-8555-555555555555",
  };

  it("creates and returns the stored row", async () => {
    const created = row({ ...input, notification_type: "INTERVIEW_REMINDER" });
    const client = fakeAuthedClient({ from: () => fakeQueryResult(created) });
    await expect(createNotification(client as never, input)).resolves.toEqual(created);
  });

  it("tolerates the dedupe-key unique violation and yields null", async () => {
    const client = fakeAuthedClient({
      from: () => fakeQueryResult(null, { code: "23505", message: "duplicate" }),
    });
    await expect(createNotificationOnce(client as never, input)).resolves.toBeNull();
  });

  it("rethrows any other write error", async () => {
    const client = fakeAuthedClient({
      from: () => fakeQueryResult(null, { message: "constraint" }),
    });
    await expect(createNotificationOnce(client as never, input)).rejects.toThrow(/create notification/);
  });
});