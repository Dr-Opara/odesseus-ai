import { describe, expect, it } from "vitest";
import {
  PINNED_COUNTRY_CODES,
  currencyLabel,
  languageLabel,
  orderCountriesForPicker,
  uniqueCountryCurrencies,
  uniqueCountryLanguages,
  uniqueCountryLocales,
} from "@/lib/countries/picker";
import type { Country } from "@/lib/countries/service";

function country(
  code: string,
  name: string,
  overrides: Partial<Country> = {}
): Country {
  return {
    code,
    name,
    default_currency: "USD",
    default_locale: "en-US",
    calling_code: "+1",
    active: true,
    ...overrides,
  };
}

const us = country("US", "United States");
const gb = country("GB", "United Kingdom");
const ca = country("CA", "Canada");
const de = country("DE", "Germany", {
  default_currency: "EUR",
  default_locale: "de-DE",
});
const ng = country("NG", "Nigeria", {
  default_currency: "NGN",
  default_locale: "en-NG",
});
const ao = country("AO", "Angola", {
  default_currency: "AOA",
  default_locale: "pt-AO",
});

describe("country picker pinning (frontend only)", () => {
  it("pins US, GB, and CA first in that order, then sorts the rest by name", () => {
    const ordered = orderCountriesForPicker([de, ng, ca, ao, us, gb]);

    expect(ordered.map((entry) => entry.code)).toEqual([
      "US",
      "GB",
      "CA",
      "AO",
      "DE",
      "NG",
    ]);
  });

  it("works regardless of input order and never duplicates a pinned country", () => {
    const ordered = orderCountriesForPicker([gb, de, gb, us]);

    expect(ordered.map((entry) => entry.code)).toEqual(["US", "GB", "DE"]);
  });

  it("skips pinned codes that are missing from the dataset", () => {
    const ordered = orderCountriesForPicker([de, ao]);

    expect(ordered.map((entry) => entry.code)).toEqual(["AO", "DE"]);
    expect(PINNED_COUNTRY_CODES).toEqual(["US", "GB", "CA"]);
  });

  it("keeps pinning as a display concern with no data-layer flags", () => {
    expect(Object.keys(us)).not.toContain("pinned");
    expect(Object.keys(us)).not.toContain("priority");
    expect(Object.keys(us).sort()).toEqual([
      "active",
      "calling_code",
      "code",
      "default_currency",
      "default_locale",
      "name",
    ]);
  });
});

describe("picker option helpers", () => {
  it("derives unique languages, locales, and currencies from the dataset", () => {
    const caWithLocale = { ...ca, default_locale: "en-CA", default_currency: "CAD" };
    const gbWithLocale = { ...gb, default_locale: "en-GB", default_currency: "GBP" };
    const dataset = [us, de, ng, ao, gbWithLocale, caWithLocale];

    expect(uniqueCountryLanguages(dataset)).toEqual(["de", "en", "pt"]);
    expect(uniqueCountryLocales(dataset)).toEqual([
      "de-DE",
      "en-CA",
      "en-GB",
      "en-NG",
      "en-US",
      "pt-AO",
    ]);
    expect(uniqueCountryCurrencies(dataset)).toEqual([
      "AOA",
      "CAD",
      "EUR",
      "GBP",
      "NGN",
      "USD",
    ]);
  });

  it("labels languages and currencies without throwing", () => {
    expect(languageLabel("en")).toBeTruthy();
    expect(currencyLabel("USD")).toBeTruthy();
    // An unknown subtag falls back to the raw code instead of throwing.
    expect(languageLabel("xx")).toBe("xx");
  });
});
