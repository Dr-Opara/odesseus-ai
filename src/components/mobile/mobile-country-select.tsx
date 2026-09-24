"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Country } from "@/lib/countries/service";

const SUGGESTED_CODES = ["US", "GB", "CA"];

/**
 * Mobile Select Countries (screen 31). Reuses the real country catalog
 * (`/api/countries`, seeded in the Phase 1 global-identity migration) and
 * saves through the existing `PATCH /api/profile/localization` endpoint —
 * the same one the desktop Language & Region settings use.
 */
export default function MobileCountrySelect({
  countries,
  initialCountryCode,
}: {
  countries: Country[];
  initialCountryCode: string | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(initialCountryCode);
  const [saving, setSaving] = useState(false);

  const suggested = useMemo(
    () => SUGGESTED_CODES.map((code) => countries.find((c) => c.code === code)).filter(
      (c): c is Country => Boolean(c)
    ),
    [countries]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rest = countries.filter((c) => !SUGGESTED_CODES.includes(c.code));
    if (!q) return rest;
    return rest.filter((c) => c.name.toLowerCase().includes(q));
  }, [countries, query]);

  async function apply() {
    if (!selected) return;
    setSaving(true);
    await fetch("/api/profile/localization", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country_code: selected }),
    }).catch(() => null);
    setSaving(false);
    router.push("/settings/work-authorization");
    router.refresh();
  }

  function Row({ country }: { country: Country }) {
    const isActive = selected === country.code;
    return (
      <button
        type="button"
        className={`m-card m-country-row${isActive ? " is-selected" : ""}`}
        onClick={() => setSelected(country.code)}
      >
        <span className="m-flag" aria-hidden="true">
          🌐
        </span>
        <span className="m-copy">
          <strong>{country.name}</strong>
        </span>
        <span className={`m-radio${isActive ? " is-checked" : ""}`} aria-hidden="true" />
      </button>
    );
  }

  return (
    <main className="odesseus-mobile-only m-screen m-screen-31" style={{ minHeight: 1220 }}>
      <header className="m-screen-header">
        <button type="button" onClick={() => history.back()} aria-label="Back">
          ←
        </button>
        <h1>
          <span>Where do you want to work?</span>
        </h1>
      </header>

      <div className="m-search">
        <input
          placeholder="⌕ Search countries"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {!query ? (
        <>
          <p className="m-eyebrow" style={{ margin: "10px 4px 6px" }}>
            SUGGESTED
          </p>
          <div className="m-list">
            {suggested.map((country) => (
              <Row country={country} key={country.code} />
            ))}
          </div>
          <p className="m-eyebrow" style={{ margin: "16px 4px 6px" }}>
            ALL COUNTRIES
          </p>
        </>
      ) : null}

      <div className="m-list">
        {filtered.map((country) => (
          <Row country={country} key={country.code} />
        ))}
      </div>

      <button className="m-action" type="button" disabled={!selected || saving} onClick={apply}>
        {saving ? "Saving…" : `Apply${selected ? " (1 selected)" : ""}`}
      </button>
    </main>
  );
}
