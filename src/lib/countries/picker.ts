import type { Country } from "./service";

/**
 * Countries shown first in pickers.
 *
 * This ordering exists ONLY in the frontend. The database stores no pin,
 * priority, or region flag for these countries — see the global-identity
 * tests, which assert the countries table has no such column.
 */
export const PINNED_COUNTRY_CODES = ["US", "GB", "CA"] as const;

/**
 * Returns countries with the pinned codes first (in pinned order), followed
 * by the remaining countries sorted by name. Pinned codes missing from the
 * input are skipped, and duplicates are never emitted.
 */
export function orderCountriesForPicker(countries: Country[]): Country[] {
  const seen = new Set<string>();
  const pinned: Country[] = [];

  for (const code of PINNED_COUNTRY_CODES) {
    const match = countries.find((country) => country.code === code);
    if (match && !seen.has(match.code)) {
      pinned.push(match);
      seen.add(match.code);
    }
  }

  const rest = countries
    .filter((country) => !seen.has(country.code))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  return [...pinned, ...rest];
}

/** Unique language subtags (for example "en") across the dataset. */
export function uniqueCountryLanguages(countries: Country[]): string[] {
  const languages = new Set<string>();
  for (const country of countries) {
    const language = country.default_locale.split("-")[0];
    if (language) languages.add(language);
  }
  return [...languages].sort((a, b) => a.localeCompare(b));
}

/** Unique locale values (for example "en-US") across the dataset. */
export function uniqueCountryLocales(countries: Country[]): string[] {
  return [...new Set(countries.map((country) => country.default_locale))].sort(
    (a, b) => a.localeCompare(b)
  );
}

/** Unique currency codes (for example "USD") across the dataset. */
export function uniqueCountryCurrencies(countries: Country[]): string[] {
  return [
    ...new Set(countries.map((country) => country.default_currency)),
  ].sort((a, b) => a.localeCompare(b));
}

/** Human label for a language subtag, falling back to the code itself. */
export function languageLabel(code: string): string {
  try {
    const display = new Intl.DisplayNames(["en"], { type: "language" });
    return display.of(code) || code;
  } catch {
    return code;
  }
}

/** Human label for a currency code, falling back to the code itself. */
export function currencyLabel(code: string): string {
  try {
    const display = new Intl.DisplayNames(["en"], { type: "currency" });
    return display.of(code) || code;
  } catch {
    return code;
  }
}

/** Browser time zone list when supported, otherwise an empty list. */
export function browserTimeZones(): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };
  if (typeof intl.supportedValuesOf !== "function") return [];
  try {
    return intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}
