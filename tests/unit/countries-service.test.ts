import { describe, expect, it, vi } from "vitest";
import { fakeQueryResult } from "../helpers/fake-supabase";
import { getCountry, listCountries } from "@/lib/countries/service";

type CountryClient = Parameters<typeof listCountries>[0];

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

function makeClient(builder: unknown) {
  return {
    from: vi.fn(() => builder),
  } as unknown as CountryClient;
}

describe("country service", () => {
  it("lists active countries selected explicitly and ordered by name", async () => {
    const builder = fakeQueryResult(rows);
    const client = makeClient(builder);

    const result = await listCountries(client);

    expect(result).toEqual(rows);
    expect(builder.select).toHaveBeenCalledWith(
      expect.stringContaining("code,name,default_currency")
    );
    expect(builder.eq).toHaveBeenCalledWith("active", true);
    expect(builder.order).toHaveBeenCalledWith("name", { ascending: true });
  });

  it("can include inactive territories on request", async () => {
    const builder = fakeQueryResult(rows);
    const client = makeClient(builder);

    await listCountries(client, { activeOnly: false });

    expect(builder.eq).not.toHaveBeenCalled();
    expect(builder.order).toHaveBeenCalledWith("name", { ascending: true });
  });

  it("surfaces query failures instead of returning partial data", async () => {
    const builder = fakeQueryResult(null, { message: "db down" });
    const client = makeClient(builder);

    await expect(listCountries(client)).rejects.toThrow(
      "Could not load countries: db down"
    );
  });

  it("normalizes a country lookup to an uppercase alpha-2 code", async () => {
    const builder = fakeQueryResult(rows[0]);
    const client = makeClient(builder);

    const result = await getCountry(client, " de ");

    expect(result).toEqual(rows[0]);
    expect(builder.eq).toHaveBeenCalledWith("code", "DE");
  });

  it("refuses lookups that are not two letters without touching the database", async () => {
    const builder = fakeQueryResult(rows[0]);
    const client = makeClient(builder);

    await expect(getCountry(client, "Germany")).resolves.toBeNull();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("returns null for an unknown code", async () => {
    const builder = fakeQueryResult(null);
    const client = makeClient(builder);

    await expect(getCountry(client, "zz")).resolves.toBeNull();
  });
});
