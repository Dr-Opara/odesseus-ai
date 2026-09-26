import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

type MemberFixture = { user_id: string; role: string };

// Spelled out rather than imported from the service: the point of these
// fixtures is the policy, so a drift in METERED_ROLES has to show up here as a
// failure rather than silently agreeing with itself.
const PAID_ROLES = ["admin", "recruiter", "viewer"];

const ORG_ID = "52222222-2222-4222-8222-222222222222";
const OWNER_ID = "51111111-1111-4111-8111-111111111111";
const INVITATION_ID = "6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER_ID = "5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_MEMBER_ID = "5ccccccc-cccc-4ccc-8ccc-cccccccccccc";

const createClientMock = vi.fn();
const serviceClientMock = vi.fn();
const checkoutCreate = vi.fn();
const subscriptionUpdate = vi.fn();
const subscriptionRetrieve = vi.fn();
const sendEmailMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClientMock() }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClientMock(),
}));
vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    checkout: { sessions: { create: checkoutCreate } },
    subscriptions: { update: subscriptionUpdate, retrieve: subscriptionRetrieve },
  }),
}));

async function freshRoute(path: string) {
  vi.resetModules();
  return import(path);
}

const TEAM_ROUTE = "@/app/api/employer/orgs/[orgId]/team/route";
const INVITE_ROUTE = "@/app/api/employer/orgs/[orgId]/invitations/route";
const REVOKE_ROUTE = "@/app/api/employer/orgs/[orgId]/invitations/[invitationId]/route";
const ACCEPT_ROUTE = "@/app/api/employer/invitations/accept/route";
const MEMBER_ROUTE = "@/app/api/employer/orgs/[orgId]/members/[userId]/route";
const CHECKOUT_ROUTE = "@/app/api/employer/orgs/[orgId]/seats/checkout/route";

const orgRow = { id: ORG_ID, name: "Seats Inc.", owner_user_id: OWNER_ID };
const INVITE_COLUMNS =
  "id,org_id,email,role,status,invited_by,expires_at,created_at";

/** A session client whose table results are keyed on the projected columns. */
function sessionClient(opts: {
  userId?: string | null;
  org?: unknown;
  role?: unknown;
  members?: unknown;
  invitations?: unknown;
  seatCount?: number | null;
  seatError?: unknown;
  orgError?: unknown;
  inviteInsert?: { data?: unknown; error?: unknown };
  inviteUpdate?: { data?: unknown; error?: unknown };
  accept?: { data?: unknown; error?: unknown };
}) {
  const canned: Record<string, Record<string, { data?: unknown; error?: unknown; count?: number | null }>> = {
    employer_organizations: {
      "*": opts.orgError
        ? { error: opts.orgError }
        : { data: "org" in opts ? opts.org : orgRow },
    },
    employer_members: {
      role: { data: opts.role ?? null },
      "user_id,role,created_at": { data: opts.members ?? [] },
      count: { count: Array.isArray(opts.members) ? opts.members.length : 0 },
    },
    employer_member_invitations: {
      [INVITE_COLUMNS]: opts.inviteInsert ?? {},
      id: opts.inviteUpdate ?? {},
    },
  };

  const org = ("org" in opts ? opts.org : orgRow) as { owner_user_id?: string } | null;

  const rpc = vi.fn(async (name: string) => {
    if (name === "odesseus_org_live_seat_count") {
      return { data: opts.seatCount ?? 0, error: opts.seatError ?? null };
    }
    if (name === "odesseus_org_required_seat_count") {
      // Mirror odesseus_org_required_seat_count: one seat per metered-role
      // member, excluding the organization owner. Derived from the fixture
      // rather than hardcoded so these tests express the policy itself.
      const members = Array.isArray(opts.members) ? (opts.members as MemberFixture[]) : [];
      const required = members.filter(
        (m) => PAID_ROLES.includes(m.role) && m.user_id !== org?.owner_user_id
      ).length;
      return { data: required, error: null };
    }
    if (name === "odesseus_accept_employer_invitation") {
      return { data: opts.accept?.data ?? null, error: opts.accept?.error ?? null };
    }
    return { data: null, error: null };
  });

  const from = vi.fn((table: string) => {
    const tableCanned = canned[table];
    if (!tableCanned) throw new Error(`unexpected table ${table}`);

    const query: { columns: string; head: boolean; inserted: unknown; updated: unknown } = {
      columns: "",
      head: false,
      inserted: null,
      updated: null,
    };
    const b: Record<string, unknown> = {};
    const chain = () => b;
    for (const m of ["eq", "neq", "in", "order", "limit", "range", "delete", "insert", "update"]) {
      b[m] = vi.fn(chain);
    }
    b.select = vi.fn((columns?: string, options?: { head?: boolean }) => {
      query.columns = String(columns ?? "*");
      if (options?.head) query.head = true;
      return b;
    });
    b.insert = vi.fn((payload: unknown) => {
      query.inserted = payload;
      return b;
    });
    b.update = vi.fn((payload: unknown) => {
      query.updated = payload;
      return b;
    });

    const resolve = () => {
      const key = query.head ? "count" : query.columns || "*";
      const row = tableCanned[key] ?? tableCanned["*"] ?? {};
      let data = row.data ?? null;
      if (query.updated !== null && data === null) data = [];
      return Promise.resolve({ data, error: row.error ?? null, count: row.count ?? null });
    };
    b.maybeSingle = vi.fn(resolve);
    b.single = vi.fn(resolve);
    b.then = (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => resolve().then(r, j);
    return b;
  });

  return {
    auth: {
      getClaims: vi.fn(async () => ({
        data: opts.userId ? { claims: { sub: opts.userId } } : { claims: null },
      })),
    },
    from,
    rpc,
    __from: from,
    __rpc: rpc,
  };
}

function postRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function deleteRequest(path: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, { method: "DELETE", headers });
}

function getRequest(path: string) {
  return new Request(`http://localhost${path}`);
}

/**
 * A service-role client that supports the member delete chain plus the three
 * RPCs the seat synchronization uses.
 *
 * The seat-sync results are explicit rather than defaulted so a route test has
 * to say what Stripe would be asked to do, and an unexpected call shows up as a
 * failure instead of a silent no-op.
 */
function deleteOnlyService(
  result: { error: unknown } = { error: null },
  seatSync: {
    required?: number;
    entitlement?: unknown;
    claim?: boolean;
    finishError?: { message: string } | null;
  } = {}
) {
  const claims: Array<Record<string, unknown>> = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
    if (name === "odesseus_org_required_seat_count") {
      return { data: seatSync.required ?? 0, error: null };
    }
    if (name === "odesseus_org_live_seat_subscription") {
      return { data: seatSync.entitlement ?? [], error: null };
    }
    if (name === "odesseus_claim_seat_adjustment") {
      claims.push(args);
      return { data: seatSync.claim ?? true, error: null };
    }
    if (name === "odesseus_finish_seat_adjustment") {
      return { data: null, error: seatSync.finishError ?? null };
    }
    throw new Error(`unexpected rpc ${name}`);
  });

  return {
    from: vi.fn(() => {
      const b: Record<string, unknown> = {};
      const chain = () => b;
      for (const m of ["eq", "neq", "in"]) b[m] = vi.fn(chain);
      b.delete = vi.fn(chain);
      b.then = (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(r, j);
      return b;
    }),
    rpc,
    __claims: claims,
  };
}

const orgParams = (orgId = ORG_ID) => ({ params: Promise.resolve({ orgId }) });

/**
 * A realistic inserted invitation row.
 *
 * `email` and `expires_at` are not optional in practice: the delivery path reads
 * both, so a partial fixture would test a shape the database never produces.
 */
function invitationRow(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: INVITATION_ID,
    org_id: ORG_ID,
    email: "new.recruiter@example.com",
    role: "recruiter",
    status: "pending",
    invited_by: OWNER_ID,
    expires_at: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date(now).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  createClientMock.mockReset();
  serviceClientMock.mockReset();
  checkoutCreate.mockReset();
  subscriptionUpdate.mockReset();
  subscriptionRetrieve.mockReset();
  sendEmailMock.mockReset();
  sendEmailMock.mockResolvedValue({ sent: true });
  subscriptionUpdate.mockResolvedValue({});
  subscriptionRetrieve.mockResolvedValue({
    id: "sub_seats_1",
    metadata: { odesseus_recruiter_seats: "true", odesseus_seat_count: "3" },
    items: { data: [{ id: "si_1", quantity: 3 }] },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/employer/orgs/[orgId]/team", () => {
  it("rejects an unauthenticated caller", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: null }));
    const { GET } = await freshRoute(TEAM_ROUTE);
    expect((await GET(getRequest("/x"), orgParams())).status).toBe(401);
  });

  it("404s a non-uuid org id", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID }));
    const { GET } = await freshRoute(TEAM_ROUTE);
    const response = await GET(getRequest("/x"), orgParams("not-a-uuid"));
    expect(response.status).toBe(404);
  });

  it("returns the team view for a member", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: OWNER_ID, seatCount: 2, members: [{ user_id: OWNER_ID, role: "owner" }] })
    );
    const { GET } = await freshRoute(TEAM_ROUTE);
    const response = await GET(getRequest("/x"), orgParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.team.orgName).toBe("Seats Inc.");
    // The owner holds a member row but consumes no paid seat.
    expect(body.team.seats).toEqual({
      seatsPaid: 2,
      seatsUsed: 0,
      seatsAvailable: 2,
      seatsRequired: 0,
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("counts every non-owner member as a paid seat, whatever their role", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({
        userId: OWNER_ID,
        seatCount: 3,
        members: [
          { user_id: OWNER_ID, role: "owner" },
          { user_id: OTHER_MEMBER_ID, role: "admin" },
          { user_id: MEMBER_ID, role: "recruiter" },
          { user_id: "5ddddddd-dddd-4ddd-8ddd-dddddddddddd", role: "viewer" },
        ],
      })
    );
    const { GET } = await freshRoute(TEAM_ROUTE);
    const response = await GET(getRequest("/x"), orgParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.team.seats).toEqual({
      seatsPaid: 3,
      seatsUsed: 3,
      seatsAvailable: 0,
      seatsRequired: 3,
    });
  });

  it("reports no paid seats for an owner-only organization", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: OWNER_ID, seatCount: 0, members: [] })
    );
    const { GET } = await freshRoute(TEAM_ROUTE);
    const body = await (await GET(getRequest("/x"), orgParams())).json();
    expect(body.team.seats).toEqual({
      seatsPaid: 0,
      seatsUsed: 0,
      seatsAvailable: 0,
      seatsRequired: 0,
    });
  });

  it("404s a non-member rather than confirming the org exists", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: "stranger", org: null }));
    const { GET } = await freshRoute(TEAM_ROUTE);
    expect((await GET(getRequest("/x"), orgParams())).status).toBe(404);
  });

  it("500s when the team read fails", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: OWNER_ID, orgError: { message: "db down" } })
    );
    const { GET } = await freshRoute(TEAM_ROUTE);
    expect((await GET(getRequest("/x"), orgParams())).status).toBe(500);
  });
});

describe("POST /api/employer/orgs/[orgId]/invitations", () => {
  it("rejects an untrusted origin before any work", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID }));
    const { POST } = await freshRoute(INVITE_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(
      postRequest("/x", { email: "a@example.com", role: "recruiter" }, { origin: "https://evil.example" }),
      orgParams()
    );
    expect(response.status).toBe(403);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: null }));
    const { POST } = await freshRoute(INVITE_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(
      postRequest("/x", { email: "a@example.com", role: "recruiter" }),
      orgParams()
    );
    expect(response.status).toBe(401);
  });

  it("rejects a role outside the invitable set", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID }));
    const { POST } = await freshRoute(INVITE_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(
      postRequest("/x", { email: "a@example.com", role: "owner" }),
      orgParams()
    );
    expect(response.status).toBe(400);
  });

  it("rejects a malformed email", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID }));
    const { POST } = await freshRoute(INVITE_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(
      postRequest("/x", { email: "nope", role: "recruiter" }),
      orgParams()
    );
    expect(response.status).toBe(400);
  });

  it("403s a recruiter: a paid seat is not admin rights", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: "recruiter-user", role: { role: "recruiter" } })
    );
    const { POST } = await freshRoute(INVITE_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(
      postRequest("/x", { email: "a@example.com", role: "recruiter" }),
      orgParams()
    );
    expect(response.status).toBe(403);
  });

  it("404s a non-member", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: "stranger", org: null }));
    const { POST } = await freshRoute(INVITE_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(
      postRequest("/x", { email: "a@example.com", role: "recruiter" }),
      orgParams()
    );
    expect(response.status).toBe(404);
  });

  it("issues an invitation, emails it, and returns the redemption token", async () => {
    const client = sessionClient({
      userId: OWNER_ID,
      inviteInsert: { data: invitationRow() },
    });
    createClientMock.mockResolvedValue(client);
    const { POST } = await freshRoute(INVITE_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");

    const response = await POST(
      postRequest("/x", { email: "New.Recruiter@Example.com", role: "recruiter" }),
      orgParams()
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.invitation.id).toBe(INVITATION_ID);
    // The token is still returned so the admin can pass the link on, even if the
    // email never arrives.
    expect(body.token).toMatch(/^[0-9a-f]{48}$/);
    expect(body.emailed).toBe(true);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("sends the invitation to the normalized stored address", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: OWNER_ID, inviteInsert: { data: invitationRow() } })
    );
    const { POST } = await freshRoute(INVITE_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");

    await POST(
      postRequest("/x", { email: "New.Recruiter@Example.com", role: "recruiter" }),
      orgParams()
    );

    // The accept RPC compares lower(email), so the message has to go to the
    // same normalized form the database will match on.
    const [message] = sendEmailMock.mock.calls[0] as [{ to: string }];
    expect(message.to).toBe("new.recruiter@example.com");
  });

  it("sends a link that carries the token returned to the admin", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: OWNER_ID, inviteInsert: { data: invitationRow() } })
    );
    const { POST } = await freshRoute(INVITE_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");

    const response = await POST(
      postRequest("/x", { email: "new.recruiter@example.com", role: "recruiter" }),
      orgParams()
    );
    const body = await response.json();
    const [message] = sendEmailMock.mock.calls[0] as [{ ctaHref: string }];

    // The link an admin copies and the link the recipient clicks must be the
    // same invitation.
    expect(message.ctaHref).toContain(body.token);
  });

  it("names the team in the invitation", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: OWNER_ID, inviteInsert: { data: invitationRow() } })
    );
    const { POST } = await freshRoute(INVITE_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");

    await POST(
      postRequest("/x", { email: "new.recruiter@example.com", role: "recruiter" }),
      orgParams()
    );

    const [message] = sendEmailMock.mock.calls[0] as [{ subject: string }];
    expect(message.subject).toContain("Seats Inc.");
  });

  it("still returns the invitation and token when delivery fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    sendEmailMock.mockResolvedValue({ sent: false, reason: "not_configured" });
    createClientMock.mockResolvedValue(
      sessionClient({ userId: OWNER_ID, inviteInsert: { data: invitationRow() } })
    );
    const { POST } = await freshRoute(INVITE_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");

    const response = await POST(
      postRequest("/x", { email: "new.recruiter@example.com", role: "recruiter" }),
      orgParams()
    );
    const body = await response.json();

    // The row is the fact; the email is a notification about it. Reporting a
    // failure would tell the admin nothing was invited when they can still pass
    // the link on themselves.
    expect(response.status).toBe(201);
    expect(body.invitation.id).toBe(INVITATION_ID);
    expect(body.token).toMatch(/^[0-9a-f]{48}$/);
    expect(body.emailed).toBe(false);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("never logs the redemption token or the invitee address on a delivery failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    sendEmailMock.mockResolvedValue({ sent: false, reason: "provider_error" });
    createClientMock.mockResolvedValue(
      sessionClient({ userId: OWNER_ID, inviteInsert: { data: invitationRow() } })
    );
    const { POST } = await freshRoute(INVITE_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");

    const response = await POST(
      postRequest("/x", { email: "new.recruiter@example.com", role: "recruiter" }),
      orgParams()
    );
    const { token } = await response.json();

    // Both are secrets or personal data that must not land in a log line someone
    // pastes into a ticket.
    for (const call of consoleError.mock.calls) {
      const line = JSON.stringify(call);
      expect(line).not.toContain(token);
      expect(line).not.toContain("new.recruiter@example.com");
    }
    consoleError.mockRestore();
  });

  it("does not email anyone when the invitation is a duplicate", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({
        userId: OWNER_ID,
        inviteInsert: { error: { code: "23505", message: "duplicate" } },
      })
    );
    const { POST } = await freshRoute(INVITE_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(
      postRequest("/x", { email: "a@example.com", role: "recruiter" }),
      orgParams()
    );

    expect(response.status).toBe(409);
    // The row does not exist, so there is no token to put in an email.
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("409s a duplicate pending invitation", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({
        userId: OWNER_ID,
        inviteInsert: { error: { code: "23505", message: "duplicate" } },
      })
    );
    const { POST } = await freshRoute(INVITE_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(
      postRequest("/x", { email: "a@example.com", role: "recruiter" }),
      orgParams()
    );
    expect(response.status).toBe(409);
  });

  it("500s when the insert fails for any other reason", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: OWNER_ID, inviteInsert: { error: { code: "42501" } } })
    );
    const { POST } = await freshRoute(INVITE_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(
      postRequest("/x", { email: "a@example.com", role: "recruiter" }),
      orgParams()
    );
    expect(response.status).toBe(500);
  });

  it("rate limits invitations per org and sets Retry-After", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({
        userId: OWNER_ID,
        inviteInsert: { data: invitationRow() },
      })
    );
    const { POST } = await freshRoute(INVITE_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");

    let throttled: Response | null = null;
    for (let i = 0; i < 60; i += 1) {
      const response = await POST(
        postRequest("/x", { email: `a${i}@example.com`, role: "recruiter" }),
        orgParams()
      );
      if (response.status === 429) {
        throttled = response;
        break;
      }
    }
    expect(throttled).not.toBeNull();
    expect(Number(throttled!.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});

describe("DELETE /api/employer/orgs/[orgId]/invitations/[invitationId]", () => {
  const params = (orgId = ORG_ID, invitationId = INVITATION_ID) => ({
    params: Promise.resolve({ orgId, invitationId }),
  });

  it("rejects an untrusted origin", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID }));
    const { DELETE } = await freshRoute(REVOKE_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await DELETE(
      deleteRequest("/x", { origin: "https://evil.example" }),
      params()
    );
    expect(response.status).toBe(403);
  });

  it("404s a non-uuid invitation id", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID }));
    const { DELETE } = await freshRoute(REVOKE_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await DELETE(deleteRequest("/x"), params(ORG_ID, "nope"));
    expect(response.status).toBe(404);
  });

  it("403s a non-admin member", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: "viewer-user", role: { role: "viewer" } })
    );
    const { DELETE } = await freshRoute(REVOKE_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await DELETE(deleteRequest("/x"), params());
    expect(response.status).toBe(403);
  });

  it("revokes a pending invitation", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: OWNER_ID, inviteUpdate: { data: [{ id: INVITATION_ID }] } })
    );
    const { DELETE } = await freshRoute(REVOKE_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await DELETE(deleteRequest("/x"), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, revoked: true });
  });

  it("reports revoked:false for an invitation that is no longer pending", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: OWNER_ID, inviteUpdate: { data: [] } })
    );
    const { DELETE } = await freshRoute(REVOKE_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await DELETE(deleteRequest("/x"), params());
    expect(await response.json()).toEqual({ ok: true, revoked: false });
  });
});

describe("POST /api/employer/invitations/accept", () => {
  it("rejects an untrusted origin", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: "a" }));
    const { POST } = await freshRoute(ACCEPT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(
      postRequest("/x", { token: "a".repeat(48) }, { origin: "https://evil.example" })
    );
    expect(response.status).toBe(403);
  });

  it("rejects an unauthenticated caller", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: null }));
    const { POST } = await freshRoute(ACCEPT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(postRequest("/x", { token: "a".repeat(48) }));
    expect(response.status).toBe(401);
  });

  it("joins the team on success", async () => {
    const client = sessionClient({
      userId: "new-recruiter",
      accept: {
        data: [
          {
            joined_org_id: ORG_ID,
            org_name: "Seats Inc.",
            joined_role: "recruiter",
            invitation_id: INVITATION_ID,
          },
        ],
      },
    });
    createClientMock.mockResolvedValue(client);
    const { POST } = await freshRoute(ACCEPT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");

    const response = await POST(postRequest("/x", { token: "a".repeat(48) }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.joined).toEqual({
      orgId: ORG_ID,
      orgName: "Seats Inc.",
      role: "recruiter",
    });
    // The caller identity comes from the session, never from the body.
    expect(client.__rpc).toHaveBeenCalledWith("odesseus_accept_employer_invitation", {
      p_token: "a".repeat(48),
    });
  });

  it("409s with an actionable message when the team is out of seats", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({
        userId: "new-recruiter",
        accept: {
          error: {
            message:
              "this team has no recruiter seats left; add a seat to invite another recruiter",
          },
        },
      })
    );
    const { POST } = await freshRoute(ACCEPT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(postRequest("/x", { token: "a".repeat(48) }));
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toMatch(/no recruiter seats left/i);
  });

  it("400s an expired, revoked, or wrong-account link the same way", async () => {
    for (const message of [
      "this invitation has expired",
      "this invitation has already been revoked",
      "this invitation was sent to a different email address",
      "invalid invitation link",
    ]) {
      createClientMock.mockResolvedValue(
        sessionClient({ userId: "new-recruiter", accept: { error: { message } } })
      );
      const { POST } = await freshRoute(ACCEPT_ROUTE);
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
      const response = await POST(postRequest("/x", { token: "a".repeat(48) }));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/no longer valid/);
    }
  });

  it("400s an absurdly long token without calling the database", async () => {
    const client = sessionClient({ userId: "new-recruiter" });
    createClientMock.mockResolvedValue(client);
    const { POST } = await freshRoute(ACCEPT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(postRequest("/x", { token: "a".repeat(500) }));
    expect(response.status).toBe(400);
    expect(client.__rpc).not.toHaveBeenCalled();
  });

  it("500s on an unrecognised database failure", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: "new-recruiter", accept: { error: { message: "boom" } } })
    );
    const { POST } = await freshRoute(ACCEPT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    expect((await POST(postRequest("/x", { token: "a".repeat(48) }))).status).toBe(500);
  });
});

describe("DELETE /api/employer/orgs/[orgId]/members/[userId]", () => {
  const params = (orgId = ORG_ID, userId = MEMBER_ID) => ({
    params: Promise.resolve({ orgId, userId }),
  });

  it("rejects an untrusted origin", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID }));
    const { DELETE } = await freshRoute(MEMBER_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await DELETE(
      deleteRequest("/x", { origin: "https://evil.example" }),
      params()
    );
    expect(response.status).toBe(403);
  });

  it("403s a member removing somebody else", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: MEMBER_ID, role: { role: "recruiter" } })
    );
    const { DELETE } = await freshRoute(MEMBER_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    // A different teammate: the caller is a member, but not an admin.
    const response = await DELETE(deleteRequest("/x"), params(ORG_ID, OTHER_MEMBER_ID));
    expect(response.status).toBe(403);
    expect(serviceClientMock).not.toHaveBeenCalled();
  });

  it("404s a non-member", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: "stranger", org: null }));
    const { DELETE } = await freshRoute(MEMBER_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await DELETE(deleteRequest("/x"), params());
    expect(response.status).toBe(404);
  });

  it("lets a member remove themselves without admin rights", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: MEMBER_ID, role: { role: "recruiter" } })
    );
    serviceClientMock.mockReturnValue(deleteOnlyService());

    const { DELETE } = await freshRoute(MEMBER_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await DELETE(deleteRequest("/x"), params(ORG_ID, MEMBER_ID));

    expect(response.status).toBe(200);
    // The org has no paid seat subscription, so there was nothing to resize.
    expect(await response.json()).toEqual({
      removed: MEMBER_ID,
      seatSync: "skipped_no_subscription",
    });
    // The delete is privileged work, so it runs on the service role.
    expect(serviceClientMock).toHaveBeenCalled();
  });

  it("stops billing for the freed seat when a member is removed", async () => {
    // The target's role comes from the session client's employer_members read,
    // so it has to exist or the route 404s before it reaches the delete.
    createClientMock.mockResolvedValue(
      sessionClient({ userId: OWNER_ID, role: { role: "recruiter" } })
    );
    const service = deleteOnlyService(
      { error: null },
      {
        // The roster now needs 2 seats; the org is paying for 3.
        required: 2,
        entitlement: [
          {
            seat_count: 3,
            active_until: "2026-12-01T00:00:00Z",
            stripe_subscription_id: "sub_seats_1",
            stripe_customer_id: "cus_1",
          },
        ],
      }
    );
    serviceClientMock.mockReturnValue(service);

    const { DELETE } = await freshRoute(MEMBER_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await DELETE(deleteRequest("/x"), params(ORG_ID, MEMBER_ID));

    expect(response.status).toBe(200);
    expect((await response.json()).seatSync).toBe("updated");
    expect(subscriptionUpdate).toHaveBeenCalledWith(
      "sub_seats_1",
      expect.objectContaining({ items: [{ id: "si_1", quantity: 2 }] })
    );
  });

  it("derives the new quantity from the roster after the delete, not before", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: OWNER_ID, role: { role: "recruiter" } })
    );
    const service = deleteOnlyService(
      { error: null },
      {
        required: 1,
        entitlement: [
          {
            seat_count: 2,
            active_until: "2026-12-01T00:00:00Z",
            stripe_subscription_id: "sub_seats_1",
            stripe_customer_id: "cus_1",
          },
        ],
      }
    );
    // Record the order the route did things in, so the sequencing claim is
    // checked rather than asserted in a comment.
    const order: string[] = [];
    const realFrom = service.from;
    service.from = vi.fn((...args: Parameters<typeof realFrom>) => {
      order.push("from");
      const chain = realFrom(...args) as { delete: () => unknown; then: unknown };
      const realDelete = chain.delete;
      chain.delete = vi.fn(() => {
        order.push("delete");
        return realDelete();
      });
      return chain;
    });
    const realRpc = service.rpc;
    service.rpc = vi.fn(async (name: string, ...rest: unknown[]) => {
      order.push(name);
      return (realRpc as unknown as (n: string, ...r: unknown[]) => Promise<unknown>)(
        name,
        ...rest
      );
    }) as typeof service.rpc;
    serviceClientMock.mockReturnValue(service);

    const { DELETE } = await freshRoute(MEMBER_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    await DELETE(deleteRequest("/x"), params(ORG_ID, MEMBER_ID));

    // The required count must be read after the membership row is gone.
    // Resizing against the pre-delete roster would leave the employer paying for
    // the seat that was just freed.
    expect(order.indexOf("delete")).toBeLessThan(
      order.indexOf("odesseus_org_required_seat_count")
    );
    expect(order.indexOf("odesseus_org_required_seat_count")).toBeLessThan(
      order.indexOf("odesseus_claim_seat_adjustment")
    );
  });

  it("cancels at period end when the last paid seat is freed", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: OWNER_ID, role: { role: "recruiter" } })
    );
    serviceClientMock.mockReturnValue(
      deleteOnlyService(
        { error: null },
        {
          required: 0,
          entitlement: [
            {
              seat_count: 1,
              active_until: "2026-12-01T00:00:00Z",
              stripe_subscription_id: "sub_seats_1",
              stripe_customer_id: "cus_1",
            },
          ],
        }
      )
    );

    const { DELETE } = await freshRoute(MEMBER_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await DELETE(deleteRequest("/x"), params(ORG_ID, MEMBER_ID));

    expect((await response.json()).seatSync).toBe("cancelled_at_period_end");
    expect(subscriptionUpdate).toHaveBeenCalledWith("sub_seats_1", {
      cancel_at_period_end: true,
    });
  });

  it("does not re-issue the Stripe update when the same removal runs twice", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: OWNER_ID, role: { role: "recruiter" } })
    );
    serviceClientMock.mockReturnValue(
      deleteOnlyService(
        { error: null },
        {
          required: 2,
          entitlement: [
            {
              seat_count: 3,
              active_until: "2026-12-01T00:00:00Z",
              stripe_subscription_id: "sub_seats_1",
              stripe_customer_id: "cus_1",
            },
          ],
          // The claim for this exact adjustment already exists.
          claim: false,
        }
      )
    );

    const { DELETE } = await freshRoute(MEMBER_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await DELETE(deleteRequest("/x"), params(ORG_ID, MEMBER_ID));

    expect((await response.json()).seatSync).toBe("already_applied");
    expect(subscriptionUpdate).not.toHaveBeenCalled();
    expect(subscriptionRetrieve).not.toHaveBeenCalled();
  });

  it("still reports a successful removal when the seat sync fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    createClientMock.mockResolvedValue(
      sessionClient({ userId: OWNER_ID, role: { role: "recruiter" } })
    );
    serviceClientMock.mockReturnValue(
      deleteOnlyService(
        { error: null },
        {
          required: 2,
          entitlement: [
            {
              seat_count: 3,
              active_until: "2026-12-01T00:00:00Z",
              stripe_subscription_id: "sub_seats_1",
              stripe_customer_id: "cus_1",
            },
          ],
        }
      )
    );
    subscriptionRetrieve.mockRejectedValue(new Error("stripe is down"));

    const { DELETE } = await freshRoute(MEMBER_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await DELETE(deleteRequest("/x"), params(ORG_ID, MEMBER_ID));

    // The member really is gone and seat capacity is already correct, so a
    // billing outage must not be reported as a failed removal -- that would
    // invite a repeat attempt against a row that no longer exists.
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.removed).toBe(MEMBER_ID);
    expect(body.seatSync).toBe("failed");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("does not attempt a seat sync when the delete itself failed", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    createClientMock.mockResolvedValue(
      sessionClient({ userId: OWNER_ID, role: { role: "recruiter" } })
    );
    const service = deleteOnlyService(
      { error: { message: "db down" } },
      { required: 0, entitlement: [] }
    );
    serviceClientMock.mockReturnValue(service);

    const { DELETE } = await freshRoute(MEMBER_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await DELETE(deleteRequest("/x"), params(ORG_ID, MEMBER_ID));

    expect(response.status).toBe(500);
    // Resizing Stripe against a roster that still contains the member would
    // bill for the wrong number of seats.
    expect(service.rpc).not.toHaveBeenCalled();
    expect(subscriptionUpdate).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("refuses to remove the organization owner", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID }));
    const { DELETE } = await freshRoute(MEMBER_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await DELETE(deleteRequest("/x"), params(ORG_ID, OWNER_ID));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/owner cannot be removed/);
    expect(serviceClientMock).not.toHaveBeenCalled();
  });

  it("404s a target who is not on the team", async () => {
    // The caller is the org owner, so authorization passes; the target has no
    // employer_members row, so the membership lookup finds nobody.
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID }));
    const { DELETE } = await freshRoute(MEMBER_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await DELETE(deleteRequest("/x"), params());
    expect(response.status).toBe(404);
    expect(serviceClientMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/employer/orgs/[orgId]/seats/checkout", () => {
  it("rejects an untrusted origin", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID }));
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(
      postRequest("/x", { seatCount: 2 }, { origin: "https://evil.example" }),
      orgParams()
    );
    expect(response.status).toBe(403);
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: null }));
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(postRequest("/x", { seatCount: 2 }), orgParams());
    expect(response.status).toBe(401);
  });

  it("rejects a non-integer or out-of-range seat count", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID }));
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    for (const seatCount of [0, -1, 1.5, 101, "two", null]) {
      const response = await POST(postRequest("/x", { seatCount }), orgParams());
      expect(response.status).toBe(400);
    }
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it("403s a non-admin member", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: "recruiter-user", role: { role: "recruiter" } })
    );
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(postRequest("/x", { seatCount: 2 }), orgParams());
    expect(response.status).toBe(403);
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it("starts a seat-counted subscription with the metadata the webhook requires", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID }));
    checkoutCreate.mockResolvedValue({ url: "https://checkout.stripe.com/x" });
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");

    const response = await POST(postRequest("/x", { seatCount: 3 }), orgParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url).toBe("https://checkout.stripe.com/x");
    expect(body.seatCount).toBe(3);

    const arg = checkoutCreate.mock.calls[0][0];
    // Seats are a recurring, seat-counted product: subscription mode with a
    // quantity line, priced per seat at the catalog's $20.00.
    expect(arg.mode).toBe("subscription");
    expect(arg.line_items).toHaveLength(1);
    expect(arg.line_items[0].quantity).toBe(3);
    expect(arg.line_items[0].price_data.unit_amount).toBe(2000);
    expect(arg.line_items[0].price_data.recurring).toEqual({ interval: "month" });
    expect(arg.client_reference_id).toBe(ORG_ID);
    // Exactly the contract the webhook reads to fulfil the purchase.
    expect(arg.metadata).toEqual({
      odesseus_org_id: ORG_ID,
      odesseus_recruiter_seats: "true",
      odesseus_seat_count: "3",
    });
  });

  it("503s when the site url is not configured rather than building a bad link", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID }));
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const response = await POST(postRequest("/x", { seatCount: 1 }), orgParams());
    expect(response.status).toBe(503);
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it("502s when Stripe returns no checkout url", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID }));
    checkoutCreate.mockResolvedValue({ url: null });
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(postRequest("/x", { seatCount: 1 }), orgParams());
    expect(response.status).toBe(502);
  });

  it("rate limits seat checkouts per org and sets Retry-After", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID }));
    checkoutCreate.mockResolvedValue({ url: "https://checkout.stripe.com/x" });
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");

    let throttled: Response | null = null;
    for (let i = 0; i < 20; i += 1) {
      const response = await POST(postRequest("/x", { seatCount: 1 }), orgParams());
      if (response.status === 429) {
        throttled = response;
        break;
      }
    }
    expect(throttled).not.toBeNull();
    expect(Number(throttled!.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
