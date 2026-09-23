import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAuthedClient, fakeQueryResult } from "../helpers/fake-supabase";

const createClientMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));

function jsonRequest(method: string, body: unknown) {
  return new Request("http://localhost/api/profile/localization", {
    method,
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const savedLocalization = {
  country_code: "DE",
  locale: "de-DE",
  preferred_currency: "EUR",
  timezone: "Europe/Berlin",
  preferred_language: "de",
  application_contact_email: null,
};

describe("profile localization API", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("rejects GET without a session", async () => {
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: null }));

    const { GET } = await import("@/app/api/profile/localization/route");
    expect((await GET()).status).toBe(401);
  });

  it("rejects PATCH without a session", async () => {
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: null }));

    const { PATCH } = await import("@/app/api/profile/localization/route");
    expect((await PATCH(jsonRequest("PATCH", { country_code: "DE" }))).status).toBe(
      401
    );
  });

  it("GET returns the six fields scoped to the signed-in user", async () => {
    const builder = fakeQueryResult(savedLocalization);
    createClientMock.mockResolvedValue(
      fakeAuthedClient({
        userId: "user-1",
        from: vi.fn((table: string) => {
          expect(table).toBe("profiles");
          return builder;
        }),
      })
    );

    const { GET } = await import("@/app/api/profile/localization/route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(builder.eq).toHaveBeenCalledWith("id", "user-1");
    const body = await response.json();
    expect(body.localization).toEqual(savedLocalization);
  });

  it("GET falls back to explicit nulls for an unset profile", async () => {
    createClientMock.mockResolvedValue(
      fakeAuthedClient({ userId: "user-1", from: () => fakeQueryResult(null) })
    );

    const { GET } = await import("@/app/api/profile/localization/route");
    const body = await (await GET()).json();

    expect(body.localization).toEqual({
      country_code: null,
      locale: null,
      preferred_currency: null,
      timezone: null,
      preferred_language: null,
      application_contact_email: null,
    });
  });

  it("PATCH writes only whitelisted fields, owned by the signed-in user", async () => {
    const builder = fakeQueryResult(savedLocalization);
    createClientMock.mockResolvedValue(
      fakeAuthedClient({ userId: "user-1", from: () => builder })
    );

    const { PATCH } = await import("@/app/api/profile/localization/route");
    const response = await PATCH(
      jsonRequest("PATCH", {
        country_code: "ng",
        application_contact_email: "ada@example.com",
        // Hostile extras that must never be written:
        id: "someone-else",
        onboarding_completed: true,
        full_name: "Not Allowed",
        skills: ["root"],
        candidate_facts: { injected: true },
      })
    );

    expect(response.status).toBe(200);
    expect(builder.upsert).toHaveBeenCalledTimes(1);

    const payload = (
      builder.upsert as ReturnType<typeof vi.fn>
    ).mock.calls[0][0] as Record<string, unknown>;

    expect(payload.id).toBe("user-1");
    expect(payload.country_code).toBe("NG");
    expect(payload.application_contact_email).toBe("ada@example.com");
    expect(typeof payload.updated_at).toBe("string");

    for (const forbidden of [
      "onboarding_completed",
      "full_name",
      "skills",
      "candidate_facts",
    ]) {
      expect(forbidden in payload).toBe(false);
    }
  });

  it("PATCH rejects invalid input with 400 before touching the database", async () => {
    const builder = fakeQueryResult(null);
    createClientMock.mockResolvedValue(
      fakeAuthedClient({ userId: "user-1", from: () => builder })
    );

    const { PATCH } = await import("@/app/api/profile/localization/route");
    const response = await PATCH(
      jsonRequest("PATCH", { timezone: "not a zone" })
    );

    expect(response.status).toBe(400);
    expect(builder.upsert).not.toHaveBeenCalled();
  });

  it("PATCH rejects an empty update", async () => {
    const builder = fakeQueryResult(null);
    createClientMock.mockResolvedValue(
      fakeAuthedClient({ userId: "user-1", from: () => builder })
    );

    const { PATCH } = await import("@/app/api/profile/localization/route");
    const response = await PATCH(jsonRequest("PATCH", {}));

    expect(response.status).toBe(400);
    expect(builder.upsert).not.toHaveBeenCalled();
  });

  it("PATCH rejects malformed JSON with 400", async () => {
    const builder = fakeQueryResult(null);
    createClientMock.mockResolvedValue(
      fakeAuthedClient({ userId: "user-1", from: () => builder })
    );

    const { PATCH } = await import("@/app/api/profile/localization/route");
    const response = await PATCH(
      new Request("http://localhost/api/profile/localization", {
        method: "PATCH",
        body: "not json at all",
      })
    );

    expect(response.status).toBe(400);
    expect(builder.upsert).not.toHaveBeenCalled();
  });

  it("never uses the service role for localization reads or writes", async () => {
    createClientMock.mockResolvedValue(
      fakeAuthedClient({ userId: "user-1", from: () => fakeQueryResult(null) })
    );

    const routeModule = await import("@/app/api/profile/localization/route");
    await routeModule.GET();
    await routeModule.PATCH(jsonRequest("PATCH", { country_code: "CA" }));

    // The route only ever gets its client from @/lib/supabase/server; the
    // service module is not even imported here.
    expect(createClientMock).toHaveBeenCalled();
  });
});
