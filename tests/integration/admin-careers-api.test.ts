import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeAuthedClient } from "../helpers/fake-supabase";

const createClientMock = vi.fn();
const serviceClientMock = vi.fn();
const sendEmailMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClientMock(),
}));
vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

async function freshQueueRoute() {
  vi.resetModules();
  return import("@/app/api/admin/careers/route");
}
async function freshItemRoute() {
  vi.resetModules();
  return import("@/app/api/admin/careers/[id]/route");
}
async function freshResumeRoute() {
  vi.resetModules();
  return import("@/app/api/admin/careers/[id]/resume/route");
}

const APP_ID = "44444444-4444-4444-8444-444444444444";
const OPENING_ID = "55555555-5555-4555-8555-555555555555";

const APPLICATION_ROW = {
  id: APP_ID,
  job_opening_id: OPENING_ID,
  full_name: "Ada Lovelace",
  email: "ada@example.com",
  phone: null,
  location: "London",
  work_authorization: "UK citizen",
  linkedin_url: null,
  github_url: "https://github.com/ada",
  portfolio_url: null,
  resume_url: `${APP_ID}/resume.pdf`,
  cover_letter: "I would like to work on Odesseus.",
  status: "submitted",
  applied_at: "2026-02-01T10:00:00Z",
  reviewed_at: null,
  reviewed_by: null,
  created_at: "2026-02-01T10:00:00Z",
  updated_at: "2026-02-01T10:00:00Z",
};

const OPENING_ROW = {
  id: OPENING_ID,
  title: "Founding Product Engineer",
  department: "Engineering",
  location: "Remote",
  work_type: "remote",
  description_md: "Own features end to end.",
  requirements_md: null,
  salary_min_cents: 9000000,
  salary_max_cents: 12000000,
  currency: "USD",
  status: "published",
  posted_at: "2026-01-20T00:00:00Z",
  closed_at: null,
  created_at: "2026-01-20T00:00:00Z",
};

/**
 * A chainable query builder whose resolved result is computed at await time
 * from a thunk.
 *
 * Thunk rather than a fixed value because the service issues more than one
 * query per request: a status PATCH writes and then re-reads the same table.
 * A builder that resolved one fixed value would hand the write result back to
 * the read, which is how a "row not found" test ends up passing for the wrong
 * reason.
 *
 * `data` is passed through untouched, including `null`. Coercing it to `[]`
 * here would make "the update matched no rows" indistinguishable from "the
 * update matched a row with no columns".
 */
type Resolved = { data: unknown; error?: unknown; count?: number | null };

function builder(thunk: () => Resolved) {
  const b: Record<string, unknown> = {};

  for (const method of [
    "select",
    "order",
    "limit",
    "range",
    "insert",
    "eq",
    "in",
    "neq",
    "maybeSingle",
    "single",
  ]) {
    b[method] = vi.fn(() => b);
  }
  b.update = vi.fn(() => b);
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve()
      .then(thunk)
      .then(res, rej);

  return b as never;
}

type ServiceOpts = {
  role?: string | null;
  /** What a read of `career_applications` returns. */
  applications?: unknown;
  /** What an `.update()` on `career_applications` returns; null matches nothing. */
  written?: unknown;
  /** The list of openings. */
  openings?: unknown;
  /** The single-title read, as `getOpeningTitle` issues it. */
  title?: string | null;
  signedUrl?: string | null;
  signError?: unknown;
};

function serviceClient(opts: ServiceOpts = {}) {
  const seen = { tables: [] as string[], writes: [] as unknown[], signed: [] as string[] };

  const storage = {
    from: vi.fn((bucket: string) => {
      seen.tables.push(`storage:${bucket}`);
      return {
        createSignedUrl: vi.fn(async (path: string) => {
          seen.signed.push(path);
          return opts.signError
            ? { data: null, error: opts.signError }
            : {
                data: { signedUrl: opts.signedUrl ?? "https://storage.test/signed" },
                error: null,
              };
        }),
        upload: vi.fn(async () => ({ data: null, error: null })),
      };
    }),
  };

  function applicationsTable() {
    // Per chain, not per table: a PATCH issues an update and then a fresh
    // select, and the read after the write must resolve the row, not the write
    // result. A table-scoped flag would make the two indistinguishable.
    let wrote = false;
    const b = builder(() =>
      wrote
        ? { data: opts.written ?? null }
        : {
            data: opts.applications ?? null,
            count: Array.isArray(opts.applications) ? opts.applications.length : 0,
          }
    ) as unknown as Record<string, unknown>;

    b.update = vi.fn((values: unknown) => {
      wrote = true;
      seen.writes.push(values);
      return b;
    });
    return b as never;
  }

  return {
    __seen: seen,
    from: vi.fn((table: string) => {
      seen.tables.push(table);

      if (table === "admin_users") {
        return builder(() => ({
          data: opts.role ? { user_id: "admin-1", role: opts.role } : null,
        }));
      }

      if (table === "career_applications") return applicationsTable();

      if (table === "career_job_openings") {
        // Two projections hit this table: the full column list for the queue,
        // and a bare "title" for the decision notice. Keyed off the select
        // argument so a read that asks for something else cannot accidentally
        // resolve as a title lookup.
        let projection = "";
        const b = builder(() =>
          projection === "title"
            ? { data: opts.title ? { title: opts.title } : null }
            : { data: opts.openings ?? [] }
        ) as unknown as Record<string, unknown>;
        b.select = vi.fn((columns: string) => {
          projection = columns;
          return b;
        });
        return b as never;
      }

      return builder(() => ({ data: null }));
    }),
    storage,
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { email: "admin@odesseus.ai" } } })) } },
  };
}

function adminSession() {
  return fakeAuthedClient({ userId: "admin-1", email: "admin@odesseus.ai" });
}

function get(url: string) {
  return new Request(`http://localhost${url}`);
}

function patch(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${url}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });
}

beforeEach(() => {
  createClientMock.mockReset();
  serviceClientMock.mockReset();
  sendEmailMock.mockReset();
  sendEmailMock.mockResolvedValue({ sent: true });
  process.env.NEXT_PUBLIC_SITE_URL = "https://odesseus.ai";
});

describe("GET /api/admin/careers", () => {
  it("rejects an unauthenticated caller", async () => {
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: null }));
    const { GET } = await freshQueueRoute();
    expect((await GET(get("/api/admin/careers"))).status).toBe(401);
    expect(serviceClientMock).not.toHaveBeenCalled();
  });

  it("rejects a signed-in non-admin before touching applicant data", async () => {
    const service = serviceClient({ role: null });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { GET } = await freshQueueRoute();
    expect((await GET(get("/api/admin/careers"))).status).toBe(403);
    expect(service.__seen.tables).not.toContain("career_applications");
  });

  it("refuses a finance admin, who may settle money but not read the hiring pipeline", async () => {
    const service = serviceClient({ role: "finance_admin" });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { GET } = await freshQueueRoute();
    expect((await GET(get("/api/admin/careers"))).status).toBe(403);
    expect(service.__seen.tables).not.toContain("career_applications");
  });

  it("refuses an admin_users row carrying an unrecognised role", async () => {
    const service = serviceClient({ role: "superadmin" });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { GET } = await freshQueueRoute();
    expect((await GET(get("/api/admin/careers"))).status).toBe(403);
    expect(service.__seen.tables).not.toContain("career_applications");
  });

  it("lets a marketing admin read the queue", async () => {
    const service = serviceClient({ role: "marketing_admin", applications: [APPLICATION_ROW] });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { GET } = await freshQueueRoute();
    expect((await GET(get("/api/admin/careers"))).status).toBe(200);
  });

  it("never ships the applicant's written answers in the list projection", async () => {
    // The cover letter and the social links are what a reviewer opens the row
    // for. A queue that scrolls does not need them, and a list response is the
    // easiest thing in a console to log by accident.
    const service = serviceClient({ role: "admin", applications: [APPLICATION_ROW] });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { GET } = await freshQueueRoute();
    const body = await (await GET(get("/api/admin/careers"))).json();

    expect(body.items).toHaveLength(1);
    expect(body.items[0].fullName).toBe("Ada Lovelace");
    // Triage fields a reviewer needs to open the row at all.
    expect(body.items[0].email).toBe("ada@example.com");
    expect(body.items[0].status).toBe("submitted");
    // The applicant's own words, deliberately not here.
    expect(body.items[0]).not.toHaveProperty("coverLetter");
    expect(body.items[0]).not.toHaveProperty("cover_letter");
    expect(body.items[0]).not.toHaveProperty("githubUrl");
    expect(body.items[0]).not.toHaveProperty("portfolioUrl");
    expect(body.items[0]).not.toHaveProperty("linkedinUrl");
  });

  it("rejects a status outside the pipeline rather than filtering on it", async () => {
    const service = serviceClient({ role: "admin", applications: [] });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { GET } = await freshQueueRoute();
    expect((await GET(get("/api/admin/careers?status=hacked"))).status).toBe(400);
  });

  it("rejects non-numeric pagination", async () => {
    const service = serviceClient({ role: "admin" });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { GET } = await freshQueueRoute();
    expect((await GET(get("/api/admin/careers?limit=abc"))).status).toBe(400);
  });

  it("is never cached", async () => {
    const service = serviceClient({ role: "admin", applications: [] });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { GET } = await freshQueueRoute();
    const response = await GET(get("/api/admin/careers"));
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("GET /api/admin/careers/[id]", () => {
  it("requires careers:read and returns the full row", async () => {
    const service = serviceClient({ role: "marketing_admin", applications: APPLICATION_ROW });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { GET } = await freshItemRoute();
    const response = await GET(get(`/api/admin/careers/${APP_ID}`), {
      params: Promise.resolve({ id: APP_ID }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.cover_letter).toBe("I would like to work on Odesseus.");
  });

  it("refuses a non-uuid id without querying", async () => {
    const service = serviceClient({ role: "admin" });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { GET } = await freshItemRoute();
    const response = await GET(get("/api/admin/careers/..%2Fadmin"), {
      params: Promise.resolve({ id: "../../admin" }),
    });
    expect(response.status).toBe(404);
    expect(service.__seen.tables).not.toContain("career_applications");
  });

  it("returns 404 for a missing application", async () => {
    const service = serviceClient({ role: "admin", applications: null });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { GET } = await freshItemRoute();
    const response = await GET(get(`/api/admin/careers/${APP_ID}`), {
      params: Promise.resolve({ id: APP_ID }),
    });
    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/admin/careers/[id]", () => {
  it("requires careers:manage to decide, not merely careers:read to look", async () => {
    // A reviewer can be given the queue without the ability to decide anybody's
    // fate. The two capabilities are separate, so this drives the write with a
    // session that is refused and asserts the application was never read for
    // modification.
    const service = serviceClient({ role: "finance_admin" });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { PATCH } = await freshItemRoute();
    const response = await PATCH(
      patch(`/api/admin/careers/${APP_ID}`, { status: "rejected" }, { origin: "https://odesseus.ai" }),
      { params: Promise.resolve({ id: APP_ID }) }
    );

    expect(response.status).toBe(403);
    expect(service.__seen.writes).toHaveLength(0);
  });

  it("refuses a cross-origin write", async () => {
    const service = serviceClient({ role: "admin", written: { id: APP_ID } });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { PATCH } = await freshItemRoute();
    const response = await PATCH(
      patch(`/api/admin/careers/${APP_ID}`, { status: "rejected" }, { origin: "https://evil.test" }),
      { params: Promise.resolve({ id: APP_ID }) }
    );

    expect(response.status).toBe(403);
    expect(service.__seen.tables).not.toContain("career_applications");
  });

  it("refuses a non-uuid id before the capability is even consulted", async () => {
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: null }));
    const { PATCH } = await freshItemRoute();
    const response = await PATCH(
      patch("/api/admin/careers/nope", { status: "rejected" }),
      { params: Promise.resolve({ id: "nope" }) }
    );
    // 403 is the origin check: a request with no Origin header passes it, so the
    // 401 from the capability check is the answer that proves the gate ran.
    expect(response.status).toBe(401);
  });

  it("rejects a status a reviewer may not set", async () => {
    const service = serviceClient({ role: "admin" });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { PATCH } = await freshItemRoute();
    const response = await PATCH(
      patch(`/api/admin/careers/${APP_ID}`, { status: "withdrawn" }, { origin: "https://odesseus.ai" }),
      { params: Promise.resolve({ id: APP_ID }) }
    );

    expect(response.status).toBe(400);
    expect(service.__seen.tables).not.toContain("career_applications");
  });

  it("stamps the reviewer from the session, never from the request body", async () => {
    const service = serviceClient({ role: "admin", written: { id: APP_ID } });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { PATCH } = await freshItemRoute();
    await PATCH(
      patch(
        `/api/admin/careers/${APP_ID}`,
        { status: "interview", reviewed_by: "someone-else" },
        { origin: "https://odesseus.ai" }
      ),
      { params: Promise.resolve({ id: APP_ID }) }
    );

    const write = service.__seen.writes.at(-1) as Record<string, unknown>;
    expect(write.reviewed_by).toBe("admin-1");
    expect(write.reviewed_at).toEqual(expect.any(String));
  });

  it("tells the applicant, once the decision is recorded", async () => {
    const service = serviceClient({
      role: "admin",
      written: { id: APP_ID },
      applications: APPLICATION_ROW,
      title: "Founding Product Engineer",
    });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { PATCH } = await freshItemRoute();
    await PATCH(
      patch(`/api/admin/careers/${APP_ID}`, { status: "rejected" }, { origin: "https://odesseus.ai" }),
      { params: Promise.resolve({ id: APP_ID }) }
    );

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const [message] = sendEmailMock.mock.calls[0] as [{ to: string; body: string }];
    expect(message.to).toBe("ada@example.com");
    expect(message.body).toMatch(/Founding Product Engineer/);
  });

  it("does not email for an internal queue state", async () => {
    // "reviewing" is bookkeeping. Mailing it would train applicants to ignore us.
    const service = serviceClient({
      role: "admin",
      written: { id: APP_ID },
      applications: APPLICATION_ROW,
      title: "Founding Product Engineer",
    });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { PATCH } = await freshItemRoute();
    await PATCH(
      patch(`/api/admin/careers/${APP_ID}`, { status: "reviewing" }, { origin: "https://odesseus.ai" }),
      { params: Promise.resolve({ id: APP_ID }) }
    );

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("still reports success when the notice cannot be delivered", async () => {
    // The decision is already committed. A provider outage must not tell a
    // reviewer their update failed and invite them to make it again.
    sendEmailMock.mockResolvedValue({ sent: false, reason: "network_error" });
    const service = serviceClient({
      role: "admin",
      written: { id: APP_ID },
      applications: APPLICATION_ROW,
      title: "Founding Product Engineer",
    });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { PATCH } = await freshItemRoute();
    const response = await PATCH(
      patch(`/api/admin/careers/${APP_ID}`, { status: "hired" }, { origin: "https://odesseus.ai" }),
      { params: Promise.resolve({ id: APP_ID }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("reports a second decision on a terminal application as 404, not success", async () => {
    const service = serviceClient({ role: "admin", written: null });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { PATCH } = await freshItemRoute();
    const response = await PATCH(
      patch(`/api/admin/careers/${APP_ID}`, { status: "hired" }, { origin: "https://odesseus.ai" }),
      { params: Promise.resolve({ id: APP_ID }) }
    );

    expect(response.status).toBe(404);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/careers/[id]/resume", () => {
  it("refuses a finance admin", async () => {
    const service = serviceClient({ role: "finance_admin" });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { GET } = await freshResumeRoute();
    const response = await GET(get(`/api/admin/careers/${APP_ID}/resume`), {
      params: Promise.resolve({ id: APP_ID }),
    });

    expect(response.status).toBe(403);
    expect(service.__seen.tables).not.toContain("storage:career-resumes");
  });

  it("signs the path read from the row, never one from the request", async () => {
    const service = serviceClient({
      role: "admin",
      applications: APPLICATION_ROW,
      signedUrl: "https://storage.test/signed-token",
    });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { GET } = await freshResumeRoute();
    const response = await GET(
      // A second path segment trying to name a different object.
      get(`/api/admin/careers/${APP_ID}/resume?path=someone-else%2Fsecret.pdf`),
      { params: Promise.resolve({ id: APP_ID }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: "https://storage.test/signed-token",
      expiresInSeconds: 60,
    });
    expect(service.__seen.signed).toEqual([`${APP_ID}/resume.pdf`]);
  });

  it("is short lived and never cached", async () => {
    const service = serviceClient({ role: "admin", applications: APPLICATION_ROW });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { GET } = await freshResumeRoute();
    const response = await GET(get(`/api/admin/careers/${APP_ID}/resume`), {
      params: Promise.resolve({ id: APP_ID }),
    });

    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await response.json()).expiresInSeconds).toBeLessThanOrEqual(60);
  });

  it("gives the same 404 for a missing row and for one with no readable resume", async () => {
    // Otherwise this is an enumeration oracle: try ids, and a different status
    // tells you which applications exist.
    const noRow = serviceClient({ role: "admin", applications: null });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(noRow);
    const { GET } = await freshResumeRoute();
    const missing = await GET(get(`/api/admin/careers/${APP_ID}/resume`), {
      params: Promise.resolve({ id: APP_ID }),
    });

    const pending = serviceClient({
      role: "admin",
      applications: { ...APPLICATION_ROW, resume_url: "upload-failed" },
    });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(pending);
    const unreadable = await GET(get(`/api/admin/careers/${APP_ID}/resume`), {
      params: Promise.resolve({ id: APP_ID }),
    });

    expect(missing.status).toBe(404);
    expect(unreadable.status).toBe(404);
    expect(await missing.json()).toEqual(await unreadable.json());
  });

  it("reports a storage failure as 500 without leaking the bucket path", async () => {
    const service = serviceClient({
      role: "admin",
      applications: APPLICATION_ROW,
      signError: { message: "Object not found" },
    });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);

    const { GET } = await freshResumeRoute();
    const response = await GET(get(`/api/admin/careers/${APP_ID}/resume`), {
      params: Promise.resolve({ id: APP_ID }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).not.toContain(APP_ID);
    expect(body.error).not.toContain("career-resumes");
  });
});
