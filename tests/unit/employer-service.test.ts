import { describe, expect, it, vi } from "vitest";

const ORG_ID = "52222222-2222-4222-8222-222222222222";
const OWNER_ID = "51111111-1111-4111-8111-111111111111";

import {
  INVITATION_TTL_DAYS,
  METERED_ROLES,
  OrgAccessError,
  acceptInvitation,
  authorizeOrgAdmin,
  createInvitation,
  getFeatureableJob,
  getFeaturedTierOffers,
  getOrgFeaturedView,
  getOrgRole,
  getOrgTeamView,
  isFeaturedTier,
  isPlausibleEmail,
  isValidSeatCount,
  listOrgInvitations,
  listOrgMembers,
  normalizeInviteEmail,
  revokeInvitation,
} from "@/lib/employer/service";

type Canned = Record<string, { data?: unknown; error?: unknown; count?: number | null }>;

type Query = {
  table: string;
  columns: string;
  head: boolean;
  filters: Array<[string, unknown]>;
  inserted: unknown[] | null;
  updated: unknown[] | null;
  mode: "select" | "insert" | "update";
};

/**
 * Builds a client whose `.from()` returns a FRESH chainable builder per call and
 * records each query, keyed on the projected column list.
 *
 * Two behaviours matter and neither is served by a single shared stub:
 *   * real PostgREST builds one query per `.from()` call, so the roster, the
 *     authorization probe, and the head-count on employer_members are three
 *     independent queries. A shared stub would let the last `.select()` decide
 *     what all three answer, quietly passing a broken authorization check.
 *   * resolving on the projected columns is what lets a test prove the service
 *     asks for `role` alone when probing a single membership row.
 */
function employerDb(
  tables: Record<string, Canned>,
  rpcResult: { data?: unknown; error?: unknown } = {}
) {
  const queries: Query[] = [];

  const from = vi.fn((table: string) => {
    const canned = tables[table];
    if (!canned) throw new Error(`unexpected table ${table}`);

    const query: Query = {
      table,
      columns: "",
      head: false,
      filters: [],
      inserted: null,
      updated: null,
      mode: "select",
    };
    queries.push(query);

    const b: Record<string, unknown> = {};
    const record = (column: string, value: unknown) => {
      query.filters.push([column, value]);
      return b;
    };
    for (const m of ["neq", "order", "limit", "range", "delete"]) {
      b[m] = vi.fn(() => b);
    }
    b.eq = vi.fn(record);
    b.neq = vi.fn(() => b);
    b.in = vi.fn(record);
    b.select = vi.fn((columns?: string, options?: { count?: string; head?: boolean }) => {
      query.columns = String(columns ?? "*");
      if (options?.head) query.head = true;
      return b;
    });
    b.insert = vi.fn((payload: unknown) => {
      query.mode = "insert";
      query.inserted = Array.isArray(payload) ? payload : [payload];
      return b;
    });
    b.update = vi.fn((payload: Record<string, unknown>) => {
      query.mode = "update";
      query.updated = [payload];
      return b;
    });

    const resolve = () => {
      const key = query.head ? "count" : query.columns || "*";
      const row = canned[key] ?? canned["*"] ?? {};
      // An UPDATE that matched nothing returns an empty array, which is how
      // PostgREST reports "there was nothing to do".
      const data =
        query.mode === "update" && row.data == null ? [] : (row.data ?? null);
      return Promise.resolve({ data, error: row.error ?? null, count: row.count ?? null });
    };

    b.maybeSingle = vi.fn(resolve);
    b.single = vi.fn(resolve);
    b.then = (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => resolve().then(r, j);
    return b;
  });

  const rpc = vi.fn(async () => ({
    data: rpcResult.data ?? null,
    error: rpcResult.error ?? null,
  }));

  /** All recorded queries against a table, optionally filtered by projection. */
  const select = (table: string, columns?: string) =>
    queries.filter(
      (q) => q.table === table && (columns === undefined || q.columns === columns)
    );

  return { client: { from, rpc } as never, from, rpc, queries, select };
}

// The org row carries every column both getOrgRole and getOrgTeamView project.
const orgRow = { id: ORG_ID, name: "Seats Inc.", owner_user_id: OWNER_ID };
const INVITE_COLUMNS =
  "id,org_id,email,role,status,invited_by,expires_at,created_at";

describe("normalizeInviteEmail", () => {
  it("lowercases and trims so the stored form matches lower(email)", () => {
    expect(normalizeInviteEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });
});

describe("isPlausibleEmail", () => {
  it.each([
    ["ada@example.com", true],
    ["ada.lovelace+work@sub.example.co.uk", true],
    ["ada@example", false],
    ["ada@@example.com", false],
    ["ada example.com", false],
    ["ada@", false],
    ["a@b", false],
    ["", false],
  ])("classifies %s as %s", (value, expected) => {
    expect(isPlausibleEmail(value)).toBe(expected);
  });
});

describe("getOrgRole", () => {
  it("returns owner from the organization row without a membership read", async () => {
    const { client, from } = employerDb({
      employer_organizations: { "*": { data: orgRow } },
    });
    expect(await getOrgRole(client, ORG_ID, OWNER_ID)).toBe("owner");
    // Ownership is answered from the org row alone; no membership row is needed.
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("employer_organizations");
  });

  it("returns the membership role for a non-owner member", async () => {
    const { client, select } = employerDb({
      employer_organizations: { "*": { data: orgRow } },
      employer_members: { role: { data: { role: "recruiter" } } },
    });
    expect(await getOrgRole(client, ORG_ID, "other-user")).toBe("recruiter");
    // The probe projects `role` alone and is scoped to the org and the caller.
    const probes = select("employer_members", "role");
    expect(probes).toHaveLength(1);
    expect(probes[0].filters).toEqual([
      ["org_id", ORG_ID],
      ["user_id", "other-user"],
    ]);
  });

  it("returns null for a signed-in non-member", async () => {
    const { client } = employerDb({
      employer_organizations: { "*": { data: orgRow } },
      employer_members: { role: { data: null } },
    });
    expect(await getOrgRole(client, ORG_ID, "stranger")).toBeNull();
  });

  it("returns null when the org is not visible to this caller", async () => {
    const { client } = employerDb({ employer_organizations: { "*": { data: null } } });
    expect(await getOrgRole(client, ORG_ID, OWNER_ID)).toBeNull();
  });

  it("throws rather than treating a read failure as no access", async () => {
    const { client } = employerDb({
      employer_organizations: { "*": { error: { message: "db down" } } },
    });
    await expect(getOrgRole(client, ORG_ID, OWNER_ID)).rejects.toThrow(
      /Could not load the organization/
    );
  });
});

describe("authorizeOrgAdmin", () => {
  it("admits the owner", async () => {
    const { client } = employerDb({ employer_organizations: { "*": { data: orgRow } } });
    expect(await authorizeOrgAdmin(client, ORG_ID, OWNER_ID)).toEqual({
      ok: true,
      role: "owner",
    });
  });

  it("admits an admin", async () => {
    const { client } = employerDb({
      employer_organizations: { "*": { data: orgRow } },
      employer_members: { role: { data: { role: "admin" } } },
    });
    expect(await authorizeOrgAdmin(client, ORG_ID, "u")).toEqual({ ok: true, role: "admin" });
  });

  it("refuses a recruiter: a paid seat is not admin rights", async () => {
    const { client } = employerDb({
      employer_organizations: { "*": { data: orgRow } },
      employer_members: { role: { data: { role: "recruiter" } } },
    });
    expect(await authorizeOrgAdmin(client, ORG_ID, "u")).toEqual({
      ok: false,
      reason: "not_an_admin",
    });
  });

  it("refuses a viewer", async () => {
    const { client } = employerDb({
      employer_organizations: { "*": { data: orgRow } },
      employer_members: { role: { data: { role: "viewer" } } },
    });
    expect(await authorizeOrgAdmin(client, ORG_ID, "u")).toEqual({
      ok: false,
      reason: "not_an_admin",
    });
  });

  it("distinguishes a non-member so the route can answer 404 rather than 403", async () => {
    const { client } = employerDb({ employer_organizations: { "*": { data: null } } });
    expect(await authorizeOrgAdmin(client, ORG_ID, "u")).toEqual({
      ok: false,
      reason: "not_a_member",
    });
  });
});

describe("getOrgTeamView", () => {
  it("assembles seats, roster, and invitations for an admin", async () => {
    const { client, rpc, from, select } = employerDb(
      {
        employer_organizations: { "*": { data: orgRow } },
        employer_members: {
          // The authorization probe and the roster are different projections.
          role: { data: { role: "admin" } },
          "user_id,role,created_at": {
            data: [{ user_id: "u1", role: "recruiter", created_at: "2026-01-01T00:00:00Z" }],
          },
          count: { count: 1 },
        },
        employer_member_invitations: { [INVITE_COLUMNS]: { data: [] } },
      },
      { data: 3 }
    );

    const view = await getOrgTeamView(client, ORG_ID, "admin-user");

    expect(view.orgName).toBe("Seats Inc.");
    expect(view.callerRole).toBe("admin");
    expect(view.isCallerAdmin).toBe(true);
    expect(view.members).toHaveLength(1);
    // Capacity comes from the SECURITY DEFINER RPC, never re-derived here, so
    // the "what counts as live" rule cannot drift between this read and the
    // accept-path meter that enforces it.
    expect(rpc).toHaveBeenCalledWith("odesseus_org_live_seat_count", { p_org_id: ORG_ID });
    expect(view.seats).toEqual({ seatsPaid: 3, seatsUsed: 1, seatsAvailable: 2 });
    // Seats used is a head-count over metered roles only.
    expect(select("employer_members", "user_id").map((q) => q.filters)).toContainEqual([
      ["org_id", ORG_ID],
      ["role", ["recruiter"]],
    ]);
    expect(from).toHaveBeenCalledWith("employer_member_invitations");
  });

  it("never lets the seat arithmetic go negative", async () => {
    const { client } = employerDb(
      {
        employer_organizations: { "*": { data: orgRow } },
        employer_members: { role: { data: null }, count: { count: 5 } },
        employer_member_invitations: { [INVITE_COLUMNS]: { data: [] } },
      },
      { data: 2 }
    );
    const view = await getOrgTeamView(client, ORG_ID, OWNER_ID);
    expect(view.seats).toEqual({ seatsPaid: 2, seatsUsed: 5, seatsAvailable: 0 });
  });

  it("does not even ask for invitations when the caller is not an admin", async () => {
    const { client, from } = employerDb(
      {
        employer_organizations: {
          "*": { data: { ...orgRow, owner_user_id: "someone-else" } },
        },
        employer_members: {
          role: { data: { role: "recruiter" } },
          "user_id,role,created_at": { data: [] },
          count: { count: 1 },
        },
        employer_member_invitations: { [INVITE_COLUMNS]: { data: [] } },
      },
      { data: 1 }
    );

    const view = await getOrgTeamView(client, ORG_ID, "recruiter-user");

    expect(view.isCallerAdmin).toBe(false);
    expect(view.callerRole).toBe("recruiter");
    expect(view.invitations).toEqual([]);
    // A recruiter still sees the seat numbers; they just never see the queue.
    expect(view.seats.seatsPaid).toBe(1);
    expect(from).not.toHaveBeenCalledWith("employer_member_invitations");
  });

  it("raises OrgAccessError for a non-member", async () => {
    const { client } = employerDb({ employer_organizations: { "*": { data: null } } });
    await expect(getOrgTeamView(client, ORG_ID, "stranger")).rejects.toBeInstanceOf(
      OrgAccessError
    );
  });

  it("throws when the seat capacity read fails", async () => {
    const { client } = employerDb(
      {
        employer_organizations: { "*": { data: orgRow } },
        employer_members: { role: { data: null }, count: { count: 0 } },
        employer_member_invitations: { [INVITE_COLUMNS]: { data: [] } },
      },
      { error: { message: "boom" } }
    );
    await expect(getOrgTeamView(client, ORG_ID, OWNER_ID)).rejects.toThrow(
      /Could not load seat capacity/
    );
  });
});

describe("listOrgMembers / listOrgInvitations", () => {
  it("returns the roster", async () => {
    const { client } = employerDb({
      employer_members: {
        "user_id,role,created_at": {
          data: [{ user_id: "u1", role: "viewer", created_at: "x" }],
        },
      },
    });
    expect(await listOrgMembers(client, ORG_ID)).toHaveLength(1);
  });

  it("throws on a roster read failure rather than showing an empty team", async () => {
    const { client } = employerDb({
      employer_members: { "user_id,role,created_at": { error: { message: "boom" } } },
    });
    await expect(listOrgMembers(client, ORG_ID)).rejects.toThrow(/Could not load the team/);
  });

  it("throws on an invitation read failure", async () => {
    const { client } = employerDb({
      employer_member_invitations: { [INVITE_COLUMNS]: { error: { message: "boom" } } },
    });
    await expect(listOrgInvitations(client, ORG_ID)).rejects.toThrow(
      /Could not load invitations/
    );
  });
});

describe("createInvitation", () => {
  const now = new Date("2026-03-01T12:00:00.000Z");

  it("writes a normalised, expiring, pending invitation", async () => {
    const { client, select } = employerDb({
      employer_member_invitations: {
        [INVITE_COLUMNS]: { data: { id: "inv-1", status: "pending" } },
      },
    });

    const result = await createInvitation(client, {
      orgId: ORG_ID,
      invitedBy: OWNER_ID,
      email: "  Recruiter@Example.com ",
      role: "recruiter",
      now,
      token: "fixed-token-for-test-01",
    });

    expect(result.ok).toBe(true);
    expect(select("employer_member_invitations")[0].inserted).toEqual([
      {
        org_id: ORG_ID,
        email: "recruiter@example.com",
        role: "recruiter",
        token: "fixed-token-for-test-01",
        status: "pending",
        invited_by: OWNER_ID,
        expires_at: new Date(now.getTime() + INVITATION_TTL_DAYS * 86400000).toISOString(),
      },
    ]);
  });

  it("generates a distinct unguessable token per invitation", async () => {
    const { client } = employerDb({
      employer_member_invitations: { [INVITE_COLUMNS]: { data: { id: "inv-1" } } },
    });
    const first = await createInvitation(client, {
      orgId: ORG_ID, invitedBy: OWNER_ID, email: "a@example.com", role: "recruiter", now,
    });
    const second = await createInvitation(client, {
      orgId: ORG_ID, invitedBy: OWNER_ID, email: "b@example.com", role: "recruiter", now,
    });
    expect(first.ok && first.token).toMatch(/^[0-9a-f]{48}$/);
    expect(second.ok && second.token).toMatch(/^[0-9a-f]{48}$/);
    expect(first.ok && second.ok && first.token === second.token).toBe(false);
  });

  it("rejects a malformed address before touching the database", async () => {
    const { client, from } = employerDb({ employer_member_invitations: { [INVITE_COLUMNS]: {} } });
    const result = await createInvitation(client, {
      orgId: ORG_ID, invitedBy: OWNER_ID, email: "not-an-email", role: "recruiter", now,
    });
    expect(result).toEqual({ ok: false, code: "invalid" });
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects a role that cannot be invited", async () => {
    const { client, from } = employerDb({ employer_member_invitations: { [INVITE_COLUMNS]: {} } });
    const result = await createInvitation(client, {
      orgId: ORG_ID, invitedBy: OWNER_ID, email: "a@example.com",
      role: "owner" as never, now,
    });
    expect(result).toEqual({ ok: false, code: "invalid" });
    expect(from).not.toHaveBeenCalled();
  });

  it("maps the partial unique index violation to a duplicate", async () => {
    const { client } = employerDb({
      employer_member_invitations: {
        [INVITE_COLUMNS]: { error: { code: "23505", message: "duplicate key" } },
      },
    });
    const result = await createInvitation(client, {
      orgId: ORG_ID, invitedBy: OWNER_ID, email: "a@example.com", role: "recruiter", now,
    });
    expect(result).toEqual({ ok: false, code: "duplicate" });
  });

  it("fails closed on any other database error", async () => {
    const { client } = employerDb({
      employer_member_invitations: {
        [INVITE_COLUMNS]: { error: { code: "42501", message: "rls" } },
      },
    });
    const result = await createInvitation(client, {
      orgId: ORG_ID, invitedBy: OWNER_ID, email: "a@example.com", role: "recruiter", now,
    });
    expect(result).toEqual({ ok: false, code: "error" });
  });

  it("fails closed when the insert returns no row", async () => {
    const { client } = employerDb({
      employer_member_invitations: { [INVITE_COLUMNS]: { data: null } },
    });
    const result = await createInvitation(client, {
      orgId: ORG_ID, invitedBy: OWNER_ID, email: "a@example.com", role: "recruiter", now,
    });
    expect(result).toEqual({ ok: false, code: "error" });
  });
});

describe("revokeInvitation", () => {
  it("marks a pending invitation revoked, scoped to the org", async () => {
    const { client, select } = employerDb({
      employer_member_invitations: { id: { data: [{ id: "inv-1" }] } },
    });
    expect(await revokeInvitation(client, ORG_ID, "inv-1")).toEqual({
      ok: true,
      revoked: true,
    });
    const query = select("employer_member_invitations", "id")[0];
    expect(query.updated).toEqual([{ status: "revoked" }]);
    // Scoped to the org and to pending rows, so an accepted invitation's audit
    // trail cannot be rewritten.
    expect(query.filters).toEqual([
      ["id", "inv-1"],
      ["org_id", ORG_ID],
      ["status", "pending"],
    ]);
  });

  it("reports revoked:false when nothing matched", async () => {
    const { client } = employerDb({
      employer_member_invitations: { id: { data: [] } },
    });
    expect(await revokeInvitation(client, ORG_ID, "inv-1")).toEqual({
      ok: true,
      revoked: false,
    });
  });

  it("throws on a write failure", async () => {
    const { client } = employerDb({
      employer_member_invitations: { id: { error: { message: "boom" } } },
    });
    await expect(revokeInvitation(client, ORG_ID, "inv-1")).rejects.toThrow(
      /Could not revoke that invitation/
    );
  });
});

describe("acceptInvitation", () => {
  it("returns the joined org on success", async () => {
    const { client, rpc } = employerDb({}, {
      data: [
        {
          joined_org_id: ORG_ID,
          org_name: "Seats Inc.",
          joined_role: "recruiter",
          invitation_id: "inv-1",
        },
      ],
    });
    expect(await acceptInvitation(client, "a".repeat(48))).toEqual({
      ok: true,
      orgId: ORG_ID,
      orgName: "Seats Inc.",
      role: "recruiter",
    });
    // Redemption always goes through the RPC, which owns the email match, the
    // org lock, and the seat meter.
    expect(rpc).toHaveBeenCalledWith("odesseus_accept_employer_invitation", {
      p_token: "a".repeat(48),
    });
  });

  it("trims the token before redeeming", async () => {
    const { client, rpc } = employerDb({}, { error: { message: "invalid invitation link" } });
    await acceptInvitation(client, "  " + "a".repeat(48) + "  ");
    expect(rpc).toHaveBeenCalledWith("odesseus_accept_employer_invitation", {
      p_token: "a".repeat(48),
    });
  });

  it.each([
    ["invalid invitation link"],
    ["this invitation has expired"],
    ["this invitation has already been accepted"],
    ["this invitation has already been revoked"],
    ["this invitation was sent to a different email address"],
  ])("maps %s to an invalid result", async (message) => {
    const { client } = employerDb({}, { error: { message } });
    expect(await acceptInvitation(client, "a".repeat(48))).toEqual({
      ok: false,
      code: "invalid",
    });
  });

  it("maps the seat-cap error so the route can explain it", async () => {
    const { client } = employerDb(
      {},
      { error: { message: "this team has no recruiter seats left; add a seat to invite another recruiter" } }
    );
    expect(await acceptInvitation(client, "a".repeat(48))).toEqual({
      ok: false,
      code: "no_seats",
    });
  });

  it("rejects a short token without calling the database", async () => {
    const { client, rpc } = employerDb({});
    expect(await acceptInvitation(client, "tooshort")).toEqual({ ok: false, code: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the RPC returns no row", async () => {
    const { client } = employerDb({}, { data: [] });
    expect(await acceptInvitation(client, "a".repeat(48))).toEqual({
      ok: false,
      code: "invalid",
    });
  });

  it("fails closed on an unrecognised database error", async () => {
    const { client } = employerDb({}, { error: { message: "connection reset" } });
    expect(await acceptInvitation(client, "a".repeat(48))).toEqual({
      ok: false,
      code: "error",
    });
  });
});

describe("seat contract constants", () => {
  it("meters exactly the recruiter role", () => {
    expect([...METERED_ROLES]).toEqual(["recruiter"]);
  });

  it("bounds a seat checkout quantity to whole seats in range", () => {
    expect(isValidSeatCount(1)).toBe(true);
    expect(isValidSeatCount(100)).toBe(true);
    expect(isValidSeatCount(0)).toBe(false);
    expect(isValidSeatCount(-3)).toBe(false);
    expect(isValidSeatCount(1.5)).toBe(false);
    expect(isValidSeatCount(Number.NaN)).toBe(false);
    expect(isValidSeatCount(101)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Featured listings
// ---------------------------------------------------------------------------

const JOB_ID = "5ddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER_JOB_ID = "5eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const LISTING_COLUMNS = "id,job_id,tier,starts_at,expires_at,is_active";
const JOB_COLUMNS = "id,title,location,status";

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

describe("isFeaturedTier", () => {
  it("accepts only catalog tiers", () => {
    expect(isFeaturedTier("featured_7d")).toBe(true);
    expect(isFeaturedTier("featured_14d")).toBe(true);
    expect(isFeaturedTier("ai_30d")).toBe(true);
  });

  it("rejects anything that is not a paid tier, including legacy keys", () => {
    expect(isFeaturedTier("featured")).toBe(false);
    expect(isFeaturedTier("FEATURED_7D")).toBe(false);
    expect(isFeaturedTier("app_credit")).toBe(false);
    expect(isFeaturedTier(undefined)).toBe(false);
    expect(isFeaturedTier(7)).toBe(false);
  });
});

describe("getFeaturedTierOffers", () => {
  it("mirrors the catalog prices so the page cannot advertise a stale amount", () => {
    expect(getFeaturedTierOffers()).toEqual([
      {
        tier: "featured_7d",
        label: "Featured — 7 days",
        description: "Boosted visibility for 7 days",
        amountCents: 2900,
        days: 7,
      },
      {
        tier: "featured_14d",
        label: "Featured — 14 days",
        description: "Boosted visibility for 14 days",
        amountCents: 4900,
        days: 14,
      },
      {
        tier: "ai_30d",
        label: "AI Featured — 30 days",
        description: "AI-assisted boosted visibility for 30 days",
        amountCents: 12900,
        days: 30,
      },
    ]);
  });
});

describe("getFeatureableJob", () => {
  it("returns the job when it belongs to the org and is open", async () => {
    const { client, select } = employerDb({
      employer_jobs: {
        [JOB_COLUMNS]: {
          data: { id: JOB_ID, title: "Staff Nurse", location: "Austin, TX", status: "published" },
        },
      },
    });

    expect(await getFeatureableJob(client, ORG_ID, JOB_ID)).toEqual({
      job: {
        id: JOB_ID,
        title: "Staff Nurse",
        location: "Austin, TX",
        status: "published",
        isBoosted: false,
      },
    });
    // Scoped by org as well as id: ownership is the whole point of this check.
    expect(select("employer_jobs", JOB_COLUMNS)[0].filters).toEqual([
      ["id", JOB_ID],
      ["org_id", ORG_ID],
    ]);
  });

  it("reports a job the org does not own as not found, never as another org's job", async () => {
    const { client } = employerDb({ employer_jobs: { [JOB_COLUMNS]: { data: null } } });
    expect(await getFeatureableJob(client, ORG_ID, OTHER_JOB_ID)).toEqual({
      reason: "not_found",
    });
  });

  it("refuses a closed job: paying to boost a posting nobody can apply to is a refund request", async () => {
    const { client } = employerDb({
      employer_jobs: {
        [JOB_COLUMNS]: { data: { id: JOB_ID, title: "Staff Nurse", location: null, status: "closed" } },
      },
    });
    expect(await getFeatureableJob(client, ORG_ID, JOB_ID)).toEqual({ reason: "closed" });
  });

  it("allows a draft job so a posting can be featured before it goes live", async () => {
    const { client } = employerDb({
      employer_jobs: {
        [JOB_COLUMNS]: { data: { id: JOB_ID, title: "Draft role", location: null, status: "draft" } },
      },
    });
    expect(await getFeatureableJob(client, ORG_ID, JOB_ID)).toMatchObject({
      job: { status: "draft" },
    });
  });

  it("throws rather than returning a reason when the read fails", async () => {
    const { client } = employerDb({
      employer_jobs: { [JOB_COLUMNS]: { error: { message: "db down" } } },
    });
    await expect(getFeatureableJob(client, ORG_ID, JOB_ID)).rejects.toThrow(/db down/);
  });
});

describe("getOrgFeaturedView", () => {
  function featuredDb(overrides: Record<string, Canned> = {}) {
    return employerDb({
      // Both projections are needed: the view reads id,name and the role probe
      // reads id,owner_user_id. OWNER_ID is the org owner, so authorization
      // passes without a membership row.
      employer_organizations: {
        "id,name": { data: orgRow },
        "id,owner_user_id": { data: { id: ORG_ID, owner_user_id: OWNER_ID } },
      },
      featured_listings: { [LISTING_COLUMNS]: { data: [] } },
      employer_jobs: { [JOB_COLUMNS]: { data: [] } },
      ...overrides,
    });
  }

  it("raises OrgAccessError for a non-member so the route can answer 404", async () => {
    const { client } = featuredDb({
      employer_members: { role: { data: null } },
    });
    await expect(getOrgFeaturedView(client, ORG_ID, "stranger")).rejects.toBeInstanceOf(
      OrgAccessError
    );
  });

  it("treats a listing as boosted only while the paid window is genuinely running", async () => {
    const { client } = featuredDb({
      featured_listings: {
        [LISTING_COLUMNS]: {
          data: [
            {
              id: "7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              job_id: JOB_ID,
              tier: "featured_7d",
              starts_at: daysFromNow(-1),
              expires_at: daysFromNow(6),
              is_active: true,
            },
            {
              id: "7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              job_id: OTHER_JOB_ID,
              tier: "featured_14d",
              starts_at: daysFromNow(-20),
              expires_at: daysFromNow(-6),
              is_active: true,
            },
          ],
        },
      },
      employer_jobs: {
        [JOB_COLUMNS]: {
          data: [
            { id: JOB_ID, title: "Staff Nurse", location: "Austin, TX", status: "published" },
            { id: OTHER_JOB_ID, title: "Closed role", location: null, status: "closed" },
          ],
        },
      },
    });

    const view = await getOrgFeaturedView(client, ORG_ID, OWNER_ID);
    const [live, lapsed] = view.listings;

    expect(live.isBoosted).toBe(true);
    expect(lapsed.isBoosted).toBe(false);
    // is_active is still true on the lapsed row: the sweep has not run yet. The
    // view must not advertise a boost that has already ended.
    expect(lapsed.isActive).toBe(true);
    expect(view.jobs.map((job) => job.isBoosted)).toEqual([true, false]);
  });

  it("joins job titles so a listing is readable after the posting is renamed or gone", async () => {
    const { client } = featuredDb({
      featured_listings: {
        [LISTING_COLUMNS]: {
          data: [
            {
              id: "7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              job_id: JOB_ID,
              tier: "ai_30d",
              starts_at: daysFromNow(0),
              expires_at: daysFromNow(30),
              is_active: true,
            },
            {
              id: "7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              job_id: "5ffffffff-ffff-4fff-8fff-ffffffffffff",
              tier: "featured_7d",
              starts_at: daysFromNow(-2),
              expires_at: daysFromNow(5),
              is_active: true,
            },
          ],
        },
      },
      employer_jobs: {
        [JOB_COLUMNS]: {
          data: [{ id: JOB_ID, title: "Staff Nurse", location: null, status: "published" }],
        },
      },
    });

    const view = await getOrgFeaturedView(client, ORG_ID, OWNER_ID);
    expect(view.listings.map((listing) => listing.jobTitle)).toEqual([
      "Staff Nurse",
      // The posting is gone; the purchase history is not.
      null,
    ]);
  });

  it("surfaces a stored tier the catalog no longer sells instead of coercing it", async () => {
    const { client } = featuredDb({
      featured_listings: {
        [LISTING_COLUMNS]: {
          data: [
            {
              id: "7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              job_id: JOB_ID,
              tier: "legacy_boost",
              starts_at: daysFromNow(-1),
              expires_at: daysFromNow(6),
              is_active: true,
            },
          ],
        },
      },
    });

    const view = await getOrgFeaturedView(client, ORG_ID, OWNER_ID);
    expect(view.listings[0].tier).toBe("legacy_boost");
  });

  it("orders listings newest first, by window start", async () => {
    const { client } = featuredDb({
      featured_listings: {
        [LISTING_COLUMNS]: {
          data: [
            {
              id: "7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              job_id: JOB_ID,
              tier: "featured_7d",
              starts_at: daysFromNow(-1),
              expires_at: daysFromNow(6),
              is_active: true,
            },
            {
              id: "7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              job_id: OTHER_JOB_ID,
              tier: "ai_30d",
              starts_at: daysFromNow(-10),
              expires_at: daysFromNow(20),
              is_active: true,
            },
          ],
        },
      },
    });

    const view = await getOrgFeaturedView(client, ORG_ID, OWNER_ID);
    expect(view.listings.map((listing) => listing.tier)).toEqual(["featured_7d", "ai_30d"]);
  });

  it("carries the catalog tiers on the payload", async () => {
    const { client } = featuredDb();
    const view = await getOrgFeaturedView(client, ORG_ID, OWNER_ID);
    expect(view.tiers.map((tier) => tier.amountCents)).toEqual([2900, 4900, 12900]);
  });

  it("fails loudly when the listings read fails", async () => {
    const { client } = featuredDb({
      featured_listings: { [LISTING_COLUMNS]: { error: { message: "permission denied" } } },
    });
    await expect(getOrgFeaturedView(client, ORG_ID, OWNER_ID)).rejects.toThrow(
      /permission denied/
    );
  });

  it("fails loudly when the jobs read fails", async () => {
    const { client } = featuredDb({
      employer_jobs: { [JOB_COLUMNS]: { error: { message: "timeout" } } },
    });
    await expect(getOrgFeaturedView(client, ORG_ID, OWNER_ID)).rejects.toThrow(/timeout/);
  });
});
