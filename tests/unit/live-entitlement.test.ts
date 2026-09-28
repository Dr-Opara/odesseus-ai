import { describe, expect, it, vi, beforeEach } from "vitest";

const serviceClientMock = vi.fn();

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClientMock(),
}));

import {
  isTimeBoxed,
  LIVE_ENTITLEMENT_SOURCES,
  NO_LIVE_ENTITLEMENT,
  readLiveEntitlement,
  type LiveEntitlementRow,
} from "@/lib/billing/live-entitlement";

const USER_ID = "aaaa0001-0000-4000-8000-000000000001";

/** A full row the database would return for a Live Share owner. */
const OWNER_ROW: LiveEntitlementRow = {
  has_access: true,
  source: "membership",
  plan: "share_annual",
  sessions_remaining: 20,
  period_end: "2027-09-27T00:00:00Z",
  is_owner: true,
  is_guest: false,
  membership_id: "bbbb0001-0000-4000-8000-000000000001",
  guest_limit: 10,
  activated_guest_count: 3,
};

/** An RPC that resolves the given payload, recording the arguments it was given. */
function rpcReturning(payload: unknown, error: unknown = null) {
  const rpc = vi.fn(async () => ({ data: payload, error }));
  return { __rpc: rpc, rpc };
}

beforeEach(() => {
  serviceClientMock.mockReset();
});

describe("readLiveEntitlement", () => {
  it("calls the one authoritative function with the session's user id", async () => {
    const client = rpcReturning(OWNER_ROW);
    serviceClientMock.mockReturnValue(client);

    const read = await readLiveEntitlement(USER_ID);

    expect(client.__rpc).toHaveBeenCalledWith("odesseus_get_live_entitlement", {
      p_user_id: USER_ID,
    });
    expect(read.ok).toBe(true);
    expect(read.row).toEqual(OWNER_ROW);
  });

  it("accepts either a bare object or a one-row array from PostgREST", async () => {
    // A function with named OUT parameters returns a single composite, but the
    // same signature declared RETURNS TABLE returns an array. The ambiguity is
    // resolved once, here, rather than in every caller.
    for (const payload of [OWNER_ROW, [OWNER_ROW]]) {
      serviceClientMock.mockReturnValue(rpcReturning(payload));
      const read = await readLiveEntitlement(USER_ID);
      expect(read.ok).toBe(true);
      expect(read.row).toEqual(OWNER_ROW);
    }
  });

  it("fails closed when the RPC errors", async () => {
    serviceClientMock.mockReturnValue(rpcReturning(null, { message: "connection reset" }));

    const read = await readLiveEntitlement(USER_ID);

    // Not ok, and no access. The caller gets both signals so it can answer
    // "we could not check" rather than "you have no access" — see the two
    // routes' differing responses.
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toBe("rpc_error");
    expect(read.row).toEqual(NO_LIVE_ENTITLEMENT);
    expect(read.row.has_access).toBe(false);
  });

  it("fails closed on a payload that is not the contract", async () => {
    // The dangerous case is a partial row that happens to look plausible. A
    // missing `has_access` cannot be defaulted to true, and defaulting it to
    // false while still reporting ok would hide a schema drift behind a
    // plausible answer.
    for (const payload of [null, undefined, [], {}, { has_access: "yes" }, "boom"]) {
      serviceClientMock.mockReturnValue(rpcReturning(payload));

      const read = await readLiveEntitlement(USER_ID);

      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.reason).toBe("unreadable");
      expect(read.row.has_access).toBe(false);
    }
  });

  it("defaults the non-decision fields of a partial row without inventing access", async () => {
    serviceClientMock.mockReturnValue(rpcReturning({ has_access: true, source: "passes" }));

    const read = await readLiveEntitlement(USER_ID);

    expect(read.ok).toBe(true);
    expect(read.row).toEqual({
      has_access: true,
      source: "passes",
      plan: null,
      sessions_remaining: 0,
      period_end: null,
      is_owner: false,
      is_guest: false,
      membership_id: null,
      guest_limit: 0,
      activated_guest_count: 0,
    });
  });

  it("resolves every published source and nothing outside them", async () => {
    for (const source of LIVE_ENTITLEMENT_SOURCES) {
      serviceClientMock.mockReturnValue(rpcReturning({ has_access: true, source }));
      const read = await readLiveEntitlement(USER_ID);
      expect(read.ok && read.row.source).toBe(source);
    }

    // Resolution order in SQL is membership -> guest -> passes -> annual, so
    // 'none' is last even though it is a listed source.
    expect([...LIVE_ENTITLEMENT_SOURCES]).toEqual([
      "membership",
      "guest",
      "passes",
      "annual",
      "none",
    ]);
  });
});

describe("NO_LIVE_ENTITLEMENT", () => {
  it("grants nothing on every axis at once", () => {
    // One constant, checked in full. This object is what a failed lookup
    // degrades to, and a stray `true` or a real-looking id in it is the kind of
    // thing that survives review because every individual field on its own looks
    // reasonable.
    expect(NO_LIVE_ENTITLEMENT).toEqual({
      has_access: false,
      source: "none",
      plan: null,
      sessions_remaining: 0,
      period_end: null,
      is_owner: false,
      is_guest: false,
      membership_id: null,
      guest_limit: 0,
      activated_guest_count: 0,
    });
  });
});

describe("isTimeBoxed", () => {
  it("is true for the three kinds that draw on a fair-use window", () => {
    // A member, a guest, and a legacy annual holder all get access that is not
    // spent one session at a time. Activation must not decrement these, or a
    // subscriber is told they have run out after one interview.
    for (const source of ["membership", "guest", "annual"] as const) {
      expect(isTimeBoxed({ ...NO_LIVE_ENTITLEMENT, has_access: true, source })).toBe(true);
    }
  });

  it("is false for a discrete pass, which is a real balance", () => {
    expect(isTimeBoxed({ ...NO_LIVE_ENTITLEMENT, has_access: true, source: "passes" })).toBe(false);
  });

  it("is false for no access, so the answer is not read as a spendable kind", () => {
    expect(isTimeBoxed(NO_LIVE_ENTITLEMENT)).toBe(false);
  });
});
