import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeAuthedClient, fakeQueryResult } from "../helpers/fake-supabase";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/notifications/service";

const createClientMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/notification-preferences", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const PREF_TABLE = "notification_preferences";

function prefClient(row: Record<string, boolean> | null, error: unknown = null) {
  return fakeAuthedClient({
    userId: "user-a",
    from: (table: string) =>
      table === PREF_TABLE ? fakeQueryResult(row, error) : fakeQueryResult(null),
  });
}

describe("GET /api/notification-preferences", () => {
  beforeEach(() => createClientMock.mockReset());

  it("rejects an unauthenticated caller", async () => {
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: null }));
    const { GET } = await import("@/app/api/notification-preferences/route");
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns the caller's preferences", async () => {
    createClientMock.mockResolvedValue(
      prefClient({ ...DEFAULT_NOTIFICATION_PREFERENCES, product: true })
    );
    const { GET } = await import("@/app/api/notification-preferences/route");
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preferences.product).toBe(true);
  });

  it("is never publicly cacheable", async () => {
    createClientMock.mockResolvedValue(prefClient({ ...DEFAULT_NOTIFICATION_PREFERENCES }));
    const { GET } = await import("@/app/api/notification-preferences/route");
    const response = await GET();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("returns 500 when the read fails", async () => {
    createClientMock.mockResolvedValue(
      prefClient(null, { message: "database unavailable" })
    );
    const { GET } = await import("@/app/api/notification-preferences/route");
    const response = await GET();
    expect(response.status).toBe(500);
  });
});

describe("PUT /api/notification-preferences", () => {
  beforeEach(() => createClientMock.mockReset());

  it("rejects an unauthenticated caller", async () => {
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: null }));
    const { PUT } = await import("@/app/api/notification-preferences/route");
    const response = await PUT(jsonRequest({ product: true }));
    expect(response.status).toBe(401);
  });

  it("accepts a partial channel patch", async () => {
    createClientMock.mockResolvedValue(prefClient({ ...DEFAULT_NOTIFICATION_PREFERENCES, matches: false }));
    const { PUT } = await import("@/app/api/notification-preferences/route");
    const response = await PUT(jsonRequest({ matches: false }));
    expect(response.status).toBe(200);
    expect((await response.json()).preferences.matches).toBe(false);
  });

  it("also accepts a preferences-wrapped body", async () => {
    createClientMock.mockResolvedValue(prefClient({ ...DEFAULT_NOTIFICATION_PREFERENCES, activity: false }));
    const { PUT } = await import("@/app/api/notification-preferences/route");
    const response = await PUT(jsonRequest({ preferences: { activity: false } }));
    expect(response.status).toBe(200);
  });

  it("rejects an unknown channel instead of silently ignoring it", async () => {
    createClientMock.mockResolvedValue(prefClient({ ...DEFAULT_NOTIFICATION_PREFERENCES }));
    const { PUT } = await import("@/app/api/notification-preferences/route");
    // "emails" is not a real channel: a client typo must fail loudly rather
    // than leaving the user's real preference silently unchanged.
    const response = await PUT(jsonRequest({ emails: false }));
    expect(response.status).toBe(400);
  });

  it("rejects a non-boolean channel value", async () => {
    createClientMock.mockResolvedValue(prefClient({ ...DEFAULT_NOTIFICATION_PREFERENCES }));
    const { PUT } = await import("@/app/api/notification-preferences/route");
    const response = await PUT(jsonRequest({ product: "yes" }));
    expect(response.status).toBe(400);
  });

  it("rejects an empty patch", async () => {
    createClientMock.mockResolvedValue(prefClient({ ...DEFAULT_NOTIFICATION_PREFERENCES }));
    const { PUT } = await import("@/app/api/notification-preferences/route");
    const response = await PUT(jsonRequest({}));
    expect(response.status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    createClientMock.mockResolvedValue(prefClient({ ...DEFAULT_NOTIFICATION_PREFERENCES }));
    const { PUT } = await import("@/app/api/notification-preferences/route");
    const response = await PUT(
      new Request("http://localhost/api/notification-preferences", {
        method: "PUT",
        body: "{not json",
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(response.status).toBe(400);
  });

  it("returns 500 when the write fails", async () => {
    createClientMock.mockResolvedValue(
      prefClient(null, { message: "database unavailable" })
    );
    const { PUT } = await import("@/app/api/notification-preferences/route");
    const response = await PUT(jsonRequest({ product: true }));
    expect(response.status).toBe(500);
  });
});
