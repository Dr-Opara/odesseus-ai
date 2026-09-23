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

type LocalizationInitial = {
  country_code: string | null;
  locale: string | null;
  preferred_currency: string | null;
  timezone: string | null;
  preferred_language: string | null;
  application_contact_email: string | null;
};

type LocalizationFormProps = {
  countries: Country[];
  email?: string;
  initial: LocalizationInitial | null;
};

const EMPTY = "Not specified";

function currencyOptionLabel(code: string) {
  const label = currencyLabel(code);
  return label && label !== code ? `${code} — ${label}` : code;
}

export default function LocalizationForm({
  countries,
  email,
  initial,
}: LocalizationFormProps) {
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
    <form className="card" style={{ padding: 26 }} onSubmit={save}>
      <div className="muted" style={{ fontSize: 13 }}>Location &amp; language</div>
      <h2 style={{ fontSize: 22, margin: "7px 0 16px" }}>Your defaults</h2>
      <p className="muted" style={{ margin: "0 0 16px", lineHeight: 1.55, fontSize: 14 }}>
        Odesseus uses these to pick the right roles near you, format details
        consistently, and fill in applications. Leave anything blank if you do
        not care.
      </p>

      <div style={{ display: "grid", gap: 14 }}>
        <label className="field-label">
          Country
          <select
            className="input"
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
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

        <label className="field-label">
          Preferred language
          <select
            className="input"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
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

        <label className="field-label">
          Display format (for example en-US)
          <select
            className="input"
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
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

        <label className="field-label">
          Preferred currency
          <select
            className="input"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
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

        <label className="field-label">
          Time zone
          {timeZoneOptions.length > 0 ? (
            <select
              className="input"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
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
              className="input"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="America/Chicago"
            />
          )}
        </label>

        <label className="field-label">
          Application contact email
          <input
            className="input"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder={email || "you@example.com"}
            maxLength={320}
          />
          <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
            Used when Odesseus applies for you so recruiters can reply.
            Odesseus never reads your email.
          </span>
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 20 }}>
        <button className="btn btn-primary" type="submit">Save changes</button>
        {status ? <span className="muted" style={{ fontSize: 14 }}>{status}</span> : null}
      </div>
    </form>
  );
}
