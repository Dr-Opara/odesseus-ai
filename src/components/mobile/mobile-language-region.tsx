"use client";

import { FormEvent, useMemo, useState } from "react";
import type { Country } from "@/lib/countries/service";
import {
  browserTimeZones,
  currencyLabel,
  languageLabel,
  orderCountriesForPicker,
  uniqueCountryCurrencies,
  uniqueCountryLanguages,
  uniqueCountryLocales,
} from "@/lib/countries/picker";
import MobileScreen from "@/components/mobile/mobile-screen";

type LocalizationInitial = {
  country_code: string | null;
  locale: string | null;
  preferred_currency: string | null;
  timezone: string | null;
  preferred_language: string | null;
  application_contact_email: string | null;
};

const EMPTY = "Not specified";

function currencyOptionLabel(code: string) {
  const label = currencyLabel(code);
  return label && label !== code ? `${code} — ${label}` : code;
}

/**
 * Mobile Language & Region (screen 19). Reads the profile's six localization
 * fields and saves through the existing `PATCH /api/profile/localization`
 * endpoint — the exact same one the desktop Language & Region settings and
 * the Select Countries screen use. No new fetch logic.
 */
export default function MobileLanguageRegion({
  countries,
  email,
  initial,
}: {
  countries: Country[];
  email?: string;
  initial: LocalizationInitial | null;
}) {
  const [countryCode, setCountryCode] = useState(initial?.country_code ?? "");
  const [locale, setLocale] = useState(initial?.locale ?? "");
  const [language, setLanguage] = useState(initial?.preferred_language ?? "");
  const [currency, setCurrency] = useState(initial?.preferred_currency ?? "");
  const [timezone, setTimezone] = useState(initial?.timezone ?? "");
  const [contactEmail, setContactEmail] = useState(
    initial?.application_contact_email ?? ""
  );
  const [status, setStatus] = useState("");

  const orderedCountries = useMemo(
    () => orderCountriesForPicker(countries),
    [countries]
  );
  const localeOptions = useMemo(() => uniqueCountryLocales(countries), [countries]);
  const languageOptions = useMemo(() => uniqueCountryLanguages(countries), [countries]);
  const currencyOptions = useMemo(() => uniqueCountryCurrencies(countries), [countries]);
  const timeZoneOptions = useMemo(() => browserTimeZones(), []);

  const countryKnown = orderedCountries.some((country) => country.code === countryCode);
  const localeKnown = !locale || localeOptions.includes(locale);
  const languageKnown = !language || languageOptions.includes(language);
  const currencyKnown = !currency || currencyOptions.includes(currency);
  const timezoneKnown = !timezone || timeZoneOptions.includes(timezone);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Saving…");

    const response = await fetch("/api/profile/localization", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        country_code: countryCode,
        locale,
        preferred_language: language,
        preferred_currency: currency,
        timezone,
        application_contact_email: contactEmail,
      }),
    }).catch(() => null);

    if (!response) {
      setStatus("Could not save. Try again.");
      return;
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setStatus(body?.error || "Could not save. Try again.");
      return;
    }

    setStatus("Saved");
  }

  return (
    <MobileScreen
      index="19"
      title="Language & Region"
      lead="Used to find relevant roles near you and fill in applications consistently."
    >
      <form onSubmit={save} className="m-signup-form">
        <label className="m-field">
          <span>Country</span>
          <select
            className="m-input"
            value={countryCode}
            onChange={(event) => setCountryCode(event.target.value)}
          >
            <option value="">{EMPTY}</option>
            {countryCode && !countryKnown ? (
              <option value={countryCode}>{countryCode}</option>
            ) : null}
            {orderedCountries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
        </label>

        <label className="m-field">
          <span>Preferred language</span>
          <select
            className="m-input"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            <option value="">{EMPTY}</option>
            {language && !languageKnown ? (
              <option value={language}>{language}</option>
            ) : null}
            {languageOptions.map((code) => (
              <option key={code} value={code}>
                {languageLabel(code)}
              </option>
            ))}
          </select>
        </label>

        <label className="m-field">
          <span>Display format</span>
          <select
            className="m-input"
            value={locale}
            onChange={(event) => setLocale(event.target.value)}
          >
            <option value="">{EMPTY}</option>
            {locale && !localeKnown ? (
              <option value={locale}>{locale}</option>
            ) : null}
            {localeOptions.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>

        <label className="m-field">
          <span>Preferred currency</span>
          <select
            className="m-input"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
          >
            <option value="">{EMPTY}</option>
            {currency && !currencyKnown ? (
              <option value={currency}>{currencyOptionLabel(currency)}</option>
            ) : null}
            {currencyOptions.map((code) => (
              <option key={code} value={code}>
                {currencyOptionLabel(code)}
              </option>
            ))}
          </select>
        </label>

        <label className="m-field">
          <span>Time zone</span>
          {timeZoneOptions.length > 0 ? (
            <select
              className="m-input"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            >
              <option value="">{EMPTY}</option>
              {timezone && !timezoneKnown ? (
                <option value={timezone}>{timezone}</option>
              ) : null}
              {timeZoneOptions.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="m-input"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              placeholder="America/Chicago"
            />
          )}
        </label>

        <label className="m-field">
          <span>Application contact email</span>
          <input
            className="m-input"
            type="email"
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
            placeholder={email || "you@example.com"}
            maxLength={320}
          />
        </label>

        {status ? <p className="m-note">{status}</p> : null}
        <button className="m-action" type="submit">
          Save
        </button>
      </form>
    </MobileScreen>
  );
}