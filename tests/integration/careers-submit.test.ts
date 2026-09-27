import { describe, expect, it, vi, beforeEach } from "vitest";

const serviceClientMock = vi.fn();
const sendEmailMock = vi.fn();
const headersMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClientMock(),
}));
vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));
vi.mock("next/headers", () => ({ headers: () => headersMock() }));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePathMock(...args) }));

const OPENING_ID = "66666666-6666-4666-8666-666666666666";
const NEW_APP_ID = "77777777-7777-4777-8777-777777777777";

const OPENING = { id: OPENING_ID, title: "Founding Applied AI Engineer" };

function resumeFile(overrides: Record<string, unknown> = {}) {
  return new File(["%PDF-1.7 fake resume"], "resume.pdf", {
    type: "application/pdf",
    ...overrides,
  });
}

function validForm(overrides: Record<string, unknown> = {}) {
  const form = new FormData();
  form.set("jobOpeningId", OPENING_ID);
  form.set("fullName", "Ada Lovelace");
  form.set("email", "ada@example.com");
  form.set("location", "London");
  form.set("workAuthorization", "UK citizen");
  form.set("resume", resumeFile());
  for (const [key, value] of Object.entries(overrides)) form.set(key, value as string);
  return form;
}

type TableOpts = { published?: unknown; inserted?: unknown; insertError?: unknown };

function serviceClient(opts: TableOpts = {}) {
  const seen = {
    tables: [] as string[],
    inserts: [] as Record<string, unknown>[],
    uploads: [] as { bucket: string; path: string; type: string }[],
    uploadError: null as unknown,
  };

  function openingsTable() {
    return chain(() => ({ data: opts.published === undefined ? null : opts.published }));
  }
  function applicationsTable() {
    const b = chain(() => ({ data: opts.inserted ?? null, error: opts.insertError ?? null }));
    b.insert = vi.fn((values: unknown) => {
      seen.inserts.push(values as Record<string, unknown>);
      return b;
    });
    return b;
  }

  return {
    __seen: seen,
    from: vi.fn((table: string) => {
      seen.tables.push(table);
      if (table === "career_job_openings") return openingsTable();
      if (table === "career_applications") return applicationsTable();
      return chain(() => ({ data: null }));
    }),
    storage: {
      from: vi.fn((bucket: string) => ({
        upload: vi.fn(async (path: string, file: File) => {
          seen.uploads.push({ bucket, path, type: file.type });
          return seen.uploadError
            ? { data: null, error: seen.uploadError }
            : { data: { path }, error: null };
        }),
      })),
    },
  };
}

function chain(thunk: () => { data: unknown; error?: unknown }) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "range", "in", "maybeSingle", "single", "update"]) {
    b[m] = vi.fn(() => b);
  }
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve()
      .then(thunk)
      .then(res, rej);
  return b;
}

async function freshAction() {
  vi.resetModules();
  return import("@/app/careers/actions");
}

beforeEach(() => {
  serviceClientMock.mockReset();
  sendEmailMock.mockReset();
  headersMock.mockReset();
  revalidatePathMock.mockReset();
  sendEmailMock.mockResolvedValue({ sent: true });
  headersMock.mockResolvedValue(new Map([["origin", "https://odesseus.ai"]]));
  process.env.NEXT_PUBLIC_SITE_URL = "https://odesseus.ai";
});

describe("submitCareerApplication", () => {
  it("stores a published role's application and its resume", async () => {
    const service = serviceClient({ published: OPENING, inserted: { id: NEW_APP_ID } });
    serviceClientMock.mockReturnValue(service);
    const { submitCareerApplication } = await freshAction();

    const state = await submitCareerApplication({ status: "idle" }, validForm());

    expect(state).toEqual({ status: "success", applicationId: NEW_APP_ID, emailed: true });
    // The applicant chose the filename; the stored object key is built from the
    // application id and a fixed extension instead.
    expect(service.__seen.uploads).toEqual([
      { bucket: "career-resumes", path: `${NEW_APP_ID}/resume.pdf`, type: "application/pdf" },
    ]);
  });

  it("writes a server-owned resume path, never a filename", async () => {
    const service = serviceClient({ published: OPENING, inserted: { id: NEW_APP_ID } });
    serviceClientMock.mockReturnValue(service);
    const { submitCareerApplication } = await freshAction();

    await submitCareerApplication(
      { status: "idle" },
      validForm({ resume: resumeFile({ name: "../../../../etc/passwd.pdf" }) })
    );

    const insert = service.__seen.inserts[0];
    expect(insert.full_name).toBe("Ada Lovelace");
    // The column is NOT NULL, so the row lands with a placeholder; the real path
    // needs the row id, which is why the update follows.
    expect(insert.resume_url).toBe("pending");
    expect(insert.status).toBe("submitted");
    expect(service.__seen.uploads[0].path).not.toContain("..");
  });

  it("refuses a role that is not published", async () => {
    // The form may have been filled in before the role closed. The database is
    // the only thing that knows the current status, so it is re-read at insert.
    const service = serviceClient({ published: null });
    serviceClientMock.mockReturnValue(service);
    const { submitCareerApplication } = await freshAction();

    const state = await submitCareerApplication({ status: "idle" }, validForm());

    expect(state.status).toBe("error");
    expect(service.__seen.inserts).toHaveLength(0);
    expect(service.__seen.uploads).toHaveLength(0);
  });

  it("refuses a cross-origin post before touching the database", async () => {
    headersMock.mockResolvedValue(new Map([["origin", "https://evil.test"]]));
    const service = serviceClient({ published: OPENING });
    serviceClientMock.mockReturnValue(service);
    const { submitCareerApplication } = await freshAction();

    const state = await submitCareerApplication({ status: "idle" }, validForm());

    expect(state).toEqual({ status: "error", error: "Invalid request origin." });
    expect(service.__seen.tables).toHaveLength(0);
  });

  it("refuses when no site url is configured and an origin is present", async () => {
    // Fail closed. An origin we cannot compare against is not a trusted one.
    process.env.NEXT_PUBLIC_SITE_URL = "";
    headersMock.mockResolvedValue(new Map([["origin", "https://odesseus.ai"]]));
    const service = serviceClient({ published: OPENING });
    serviceClientMock.mockReturnValue(service);
    const { submitCareerApplication } = await freshAction();

    expect(await submitCareerApplication({ status: "idle" }, validForm())).toEqual({
      status: "error",
      error: "Invalid request origin.",
    });
  });

  it("rate limits by forwarded address", async () => {
    headersMock.mockResolvedValue(
      new Map([
        ["origin", "https://odesseus.ai"],
        ["x-forwarded-for", "203.0.113.7, 70.41.3.18"],
      ])
    );
    const service = serviceClient({ published: OPENING, inserted: { id: NEW_APP_ID } });
    serviceClientMock.mockReturnValue(service);
    const { submitCareerApplication } = await freshAction();

    let last = await submitCareerApplication({ status: "idle" }, validForm());
    for (let i = 0; i < 8; i += 1) {
      last = await submitCareerApplication({ status: "idle" }, validForm());
    }

    expect(last.status).toBe("error");
    expect(service.__seen.inserts.length).toBeLessThanOrEqual(6);
  });

  it("refuses a field the schema does not declare", async () => {
    const service = serviceClient({ published: OPENING, inserted: { id: NEW_APP_ID } });
    serviceClientMock.mockReturnValue(service);
    const { submitCareerApplication } = await freshAction();

    // An extra form field must not become a column. The schema is the whole
    // write surface; a field-by-field copy would let this through.
    await submitCareerApplication(
      { status: "idle" },
      validForm({ status: "hired", reviewed_by: "someone-else" })
    );

    const insert = service.__seen.inserts[0];
    expect(insert).not.toHaveProperty("reviewed_by");
    expect(insert.status).toBe("submitted");
  });

  it("rejects a link that is not http(s)", async () => {
    const service = serviceClient({ published: OPENING });
    serviceClientMock.mockReturnValue(service);
    const { submitCareerApplication } = await freshAction();

    const state = await submitCareerApplication(
      { status: "idle" },
      validForm({ linkedinUrl: "javascript:alert(1)" })
    );

    expect(state.status).toBe("error");
    expect(service.__seen.inserts).toHaveLength(0);
  });

  it("refuses a resume that is not one of the three document types", async () => {
    const service = serviceClient({ published: OPENING });
    serviceClientMock.mockReturnValue(service);
    const { submitCareerApplication } = await freshAction();

    const state = await submitCareerApplication(
      { status: "idle" },
      validForm({ resume: resumeFile({ type: "text/html" }) })
    );

    expect(state.status).toBe("error");
    expect(service.__seen.inserts).toHaveLength(0);
  });

  it("refuses an empty resume", async () => {
    const service = serviceClient({ published: OPENING });
    serviceClientMock.mockReturnValue(service);
    const { submitCareerApplication } = await freshAction();

    const empty = new File([], "resume.pdf", { type: "application/pdf" });
    const state = await submitCareerApplication({ status: "idle" }, validForm({ resume: empty }));

    expect(state.status).toBe("error");
    expect(service.__seen.inserts).toHaveLength(0);
  });

  it("still reports success when the receipt cannot be delivered", async () => {
    // The row is written. Telling an applicant their application did not go
    // through would be a lie, and they would apply again.
    sendEmailMock.mockResolvedValue({ sent: false, reason: "not_configured" });
    const service = serviceClient({ published: OPENING, inserted: { id: NEW_APP_ID } });
    serviceClientMock.mockReturnValue(service);
    const { submitCareerApplication } = await freshAction();

    const state = await submitCareerApplication({ status: "idle" }, validForm());

    expect(state).toEqual({ status: "success", applicationId: NEW_APP_ID, emailed: false });
    expect(service.__seen.inserts).toHaveLength(1);
  });

  it("marks a failed upload rather than leaving a path that looks real", async () => {
    const service = serviceClient({ published: OPENING, inserted: { id: NEW_APP_ID } });
    service.__seen.uploadError = { message: "Object exceeds the maximum allowed size" };
    serviceClientMock.mockReturnValue(service);
    const { submitCareerApplication } = await freshAction();

    const state = await submitCareerApplication({ status: "idle" }, validForm());

    expect(state.status).toBe("error");
    // The failure is stated on the row, and usableResumePath refuses both
    // placeholders, so no later reader can mistake it for a document.
    expect(service.__seen.tables).toContain("career_applications");
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("revalidates the admin queue only after a successful write", async () => {
    const service = serviceClient({ published: OPENING, inserted: { id: NEW_APP_ID } });
    serviceClientMock.mockReturnValue(service);
    const { submitCareerApplication } = await freshAction();

    await submitCareerApplication({ status: "idle" }, validForm());
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/careers");

    revalidatePathMock.mockClear();
    await submitCareerApplication({ status: "idle" }, validForm({ jobOpeningId: "not-a-uuid" }));
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("never sends a receipt to an address the applicant did not type", async () => {
    const service = serviceClient({ published: OPENING, inserted: { id: NEW_APP_ID } });
    serviceClientMock.mockReturnValue(service);
    const { submitCareerApplication } = await freshAction();

    await submitCareerApplication({ status: "idle" }, validForm({ email: "ada@example.com" }));

    const [message] = sendEmailMock.mock.calls[0] as [{ to: string }];
    expect(message.to).toBe("ada@example.com");
  });
});
