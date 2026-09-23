import { describe, expect, it } from "vitest";
import {
  LOCALIZATION_FIELDS,
  emptyLocalization,
  localizationSchema,
  pickLocalizationFields,
} from "@/lib/profile/localization";

describe("localization validation", () => {
  it("accepts a fully populated payload and normalizes casing", () => {
    const parsed = localizationSchema.parse({
      country_code: " de ",
      locale: "de-DE",
      preferred_currency: " eur",
      timezone: "Europe/Berlin",
      preferred_language: "DE",
      application_contact_email: "  janina@example.com ",
    });

    expect(parsed).toEqual({
      country_code: "DE",
      locale: "de-DE",
      preferred_currency: "EUR",
      timezone: "Europe/Berlin",
      preferred_language: "de",
      application_contact_email: "janina@example.com",
    });
  });

  it("treats blank strings as null so forms can clear a field", () => {
    const parsed = localizationSchema.parse({
      country_code: "",
      locale: "",
      preferred_currency: "",
      timezone: "",
      preferred_language: "",
      application_contact_email: "",
    });

    expect(parsed).toEqual(emptyLocalization());
  });

  it("accepts an all-null payload, matching existing users", () => {
    expect(localizationSchema.parse(emptyLocalization())).toEqual(
      emptyLocalization()
    );
  });

  it("keeps valid multi-segment locales and time zones", () => {
    expect(
      localizationSchema.parse({ locale: "zh-Hans-CN" }).locale
    ).toBe("zh-Hans-CN");
    expect(
      localizationSchema.parse({ timezone: "America/Argentina/Buenos_Aires" })
        .timezone
    ).toBe("America/Argentina/Buenos_Aires");
    expect(localizationSchema.parse({ timezone: "UTC" }).timezone).toBe("UTC");
  });

  it("rejects invalid country codes", () => {
    for (const value of ["USA", "usa!", "1", "Deutschland", "D"]) {
      expect(
        localizationSchema.safeParse({ country_code: value }).success,
        `expected ${value} to be rejected`
      ).toBe(false);
    }
  });

  it("rejects invalid currency codes", () => {
    for (const value of ["DOLLARS", "us", "USDD"]) {
      expect(localizationSchema.safeParse({ preferred_currency: value }).success).toBe(
        false
      );
    }
  });

  it("rejects invalid locales", () => {
    for (const value of ["EN-US", "english", "e", "de-"]) {
      expect(localizationSchema.safeParse({ locale: value }).success).toBe(false);
    }
  });

  it("rejects invalid time zones", () => {
    for (const value of ["not a zone", "America Chicago", "/Chicago"]) {
      expect(localizationSchema.safeParse({ timezone: value }).success).toBe(false);
    }
  });

  it("rejects invalid language codes", () => {
    for (const value of ["english", "e", "en-GB"]) {
      expect(
        localizationSchema.safeParse({ preferred_language: value }).success
      ).toBe(false);
    }
  });

  it("rejects invalid contact emails", () => {
    for (const value of ["not-an-email", "a@b", "@example.com"]) {
      expect(
        localizationSchema.safeParse({ application_contact_email: value }).success
      ).toBe(false);
    }
  });

  it("rejects non-string values", () => {
    expect(localizationSchema.safeParse({ country_code: 42 }).success).toBe(false);
    expect(localizationSchema.safeParse({ timezone: true }).success).toBe(false);
  });

  it("strips unknown keys so only whitelisted fields survive", () => {
    const update = pickLocalizationFields({
      country_code: "ng",
      onboarding_completed: true,
      id: "someone-else",
      full_name: "Not Allowed",
      skills: ["admin"],
      application_answers: {},
    });

    expect(update).toEqual({ country_code: "NG" });
  });

  it("keeps explicit nulls so fields can be cleared", () => {
    const update = pickLocalizationFields({
      country_code: null,
      application_contact_email: "",
    });

    expect(update).toEqual({
      country_code: null,
      application_contact_email: null,
    });
  });

  it("throws on invalid input so routes can answer 400", () => {
    expect(() => pickLocalizationFields({ timezone: "not a zone" })).toThrow();
    expect(() => pickLocalizationFields("not an object")).toThrow();
  });

  it("covers exactly the six Phase 1 fields", () => {
    expect([...LOCALIZATION_FIELDS].sort()).toEqual(
      [
        "application_contact_email",
        "country_code",
        "locale",
        "preferred_currency",
        "preferred_language",
        "timezone",
      ].sort()
    );

    const allPresent = pickLocalizationFields(emptyLocalization());
    expect(Object.keys(allPresent).sort()).toEqual(
      [...LOCALIZATION_FIELDS].sort()
    );
  });
});
