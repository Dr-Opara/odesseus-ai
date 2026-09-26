import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_CHANNELS,
  getNotificationPreferences,
  updateNotificationPreferences,
} from "@/lib/notifications/service";
import { fakeQueryResult } from "../helpers/fake-supabase";

// Minimal in-memory stand-in for the notification_preferences table. It
// reproduces the two behaviours the real table's RLS + primary key give us:
// reads/writes are keyed to a single user_id row, and an upsert for a user
// with no row creates it.
function fakePreferencesStore() {
  const rows = new Map<string, Record<string, boolean>>();
  const from = vi.fn((table: string) => {
    if (table !== "notification_preferences") {
      return fakeQueryResult(null, { message: `unexpected table ${table}` });
    }

    // Chain state, mirroring the real builder's accumulate-then-execute model.
    const state: { mode: "select" | "upsert"; payload?: Record<string, boolean>; userId?: string } = {
      mode: "select",
    };
    const builder: Record<string, unknown> = {};
    const chain = (method: string) =>
      vi.fn((...args: unknown[]) => {
        if (method === "upsert") {
          state.mode = "upsert";
          state.payload = args[0] as Record<string, boolean>;
        }
        if (method === "eq") {
          const [column, value] = args as [string, string];
          if (column === "user_id") state.userId = value;
        }
        return builder;
      });

    for (const method of ["select", "eq", "neq", "order", "limit", "insert", "update", "delete"]) {
      builder[method] = chain(method);
    }
    builder.upsert = chain("upsert");

    const resolve = () => {
      if (state.mode === "upsert") {
        const payload = state.payload ?? {};
        const userId = String(payload.user_id ?? state.userId);
        const existing = rows.get(userId) ?? { ...DEFAULT_NOTIFICATION_PREFERENCES };
        const next = { ...existing };
        for (const channel of NOTIFICATION_CHANNELS) {
          if (typeof payload[channel] === "boolean") next[channel] = payload[channel];
        }
        rows.set(userId, next);
        return Promise.resolve({ data: { ...next }, error: null });
      }
      const row = state.userId ? rows.get(state.userId) : undefined;
      return Promise.resolve({ data: row ? { ...row } : null, error: null });
    };

    builder.maybeSingle = vi.fn(resolve);
    builder.single = vi.fn(resolve);
    builder.then = (res: (v: unknown) => unknown, rej?: (r: unknown) => unknown) =>
      resolve().then(res, rej);
    return builder;
  });

  return { from, rows };
}

describe("notification preference defaults", () => {
  it("covers exactly the five channels the product offers", () => {
    expect([...NOTIFICATION_CHANNELS].sort()).toEqual([
      "activity",
      "applications",
      "documents",
      "matches",
      "product",
    ]);
  });

  it("leaves candidate-relevant channels on and product updates off", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES).toEqual({
      applications: true,
      documents: true,
      matches: true,
      activity: true,
      product: false,
    });
  });
});

describe("getNotificationPreferences", () => {
  it("returns the product defaults when the user has no row yet", async () => {
    const store = fakePreferencesStore();
    const result = await getNotificationPreferences({ from: store.from } as never, "user-a");
    expect(result).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it("returns the stored row when one exists", async () => {
    const store = fakePreferencesStore();
    store.rows.set("user-a", { ...DEFAULT_NOTIFICATION_PREFERENCES, product: true, matches: false });
    const result = await getNotificationPreferences({ from: store.from } as never, "user-a");
    expect(result.product).toBe(true);
    expect(result.matches).toBe(false);
  });

  it("never returns another user's preferences", async () => {
    const store = fakePreferencesStore();
    store.rows.set("user-b", { ...DEFAULT_NOTIFICATION_PREFERENCES, product: true });
    const result = await getNotificationPreferences({ from: store.from } as never, "user-a");
    expect(result.product).toBe(false);
  });

  it("surfaces a read failure rather than silently reporting defaults", async () => {
    const failing = {
      from: vi.fn(() => fakeQueryResult(null, { message: "boom" })),
    };
    await expect(
      getNotificationPreferences(failing as never, "user-a")
    ).rejects.toThrow(/Could not load notification preferences/);
  });
});

describe("updateNotificationPreferences", () => {
  it("creates the row on first write and stores the requested change", async () => {
    const store = fakePreferencesStore();
    const result = await updateNotificationPreferences(
      { from: store.from } as never,
      "user-a",
      { product: true }
    );
    expect(result.product).toBe(true);
    expect(result.applications).toBe(true);
  });

  it("applies a partial patch without clobbering other channels", async () => {
    const store = fakePreferencesStore();
    store.rows.set("user-a", { ...DEFAULT_NOTIFICATION_PREFERENCES, documents: false });
    const result = await updateNotificationPreferences(
      { from: store.from } as never,
      "user-a",
      { activity: false }
    );
    expect(result.activity).toBe(false);
    // Untouched by this patch, so the previously stored value survives.
    expect(result.documents).toBe(false);
  });

  it("is idempotent for a repeated write of the same value", async () => {
    const store = fakePreferencesStore();
    const client = { from: store.from } as never;
    await updateNotificationPreferences(client, "user-a", { matches: false });
    const second = await updateNotificationPreferences(client, "user-a", { matches: false });
    expect(second.matches).toBe(false);
    expect(store.rows.get("user-a")?.matches).toBe(false);
  });

  it("keeps one user's preferences isolated from another's", async () => {
    const store = fakePreferencesStore();
    const client = { from: store.from } as never;
    await updateNotificationPreferences(client, "user-a", { product: true });
    await updateNotificationPreferences(client, "user-b", { product: false });
    expect((await getNotificationPreferences(client, "user-a")).product).toBe(true);
    expect((await getNotificationPreferences(client, "user-b")).product).toBe(false);
  });

  it("ignores a non-boolean value and performs no write", async () => {
    const store = fakePreferencesStore();
    const client = { from: store.from } as never;
    const result = await updateNotificationPreferences(client, "user-a", {
      // A hostile/naive client sending a non-boolean must not be written.
      ...({ product: "yes" } as unknown as Record<string, boolean>),
    });
    expect(result.product).toBe(false);
    expect(store.rows.has("user-a")).toBe(false);
  });

  it("surfaces a write failure instead of reporting a false success", async () => {
    const failing = {
      from: vi.fn(() => fakeQueryResult(null, { message: "boom" })),
    };
    await expect(
      updateNotificationPreferences(failing as never, "user-a", { product: true })
    ).rejects.toThrow(/Could not save notification preferences/);
  });
});
