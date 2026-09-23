import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAuthedClient, fakeQueryResult } from "../helpers/fake-supabase";

const createClientMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));

const rows = [
  {
    code: "DE",
    name: "Germany",
    default_currency: "EUR",
    default_locale: "de-DE",
    calling_code: "+49",
    active: true,
  },
  {
    code: "US",
    name: "United States",
    default_currency: "USD",
    default_locale: "en-US",
    calling_code: "+1",
    active: true,
  },
];

describe("GET /api/countries", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("serves the country list without a session (public reference data)", async () => {
    const builder = fakeQueryResult(rows);
    createClientMock.mockResolvedValue(
      fakeAuthedClient({ userId: null, from: () => builder })
    );

    const { GET } = await import("@/app/api/countries/route");
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.countries).toEqual(rows);
    expect(builder.select).toHaveBeenCalledWith(
      expect.stringContaining("code,name,default_currency")
    );
    expect(builder.eq).toHaveBeenCalledWith("active", true);
    expect(builder.order).toHaveBeenCalledWith("name", { ascending: true });
  });

  it("stays available for a signed-in user too", async () => {
    const builder = fakeQueryResult(rows);
    createClientMock.mockResolvedValue(
      fakeAuthedClient({ userId: "user-1", from: () => builder })
    );

    const { GET } = await import("@/app/api/countries/route");
    const response = await GET();

    expect(response.status).toBe(200);
  });

  it("answers 500 when the country query fails", async () => {
    createClientMock.mockResolvedValue(
      fakeAuthedClient({
        userId: null,
        from: () => fakeQueryResult(null, { message: "db down" }),
      })
    );

    const { GET } = await import("@/app/api/countries/route");
    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toMatch(/countries/i);
  });
});
