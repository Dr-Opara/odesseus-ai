/**
 * Pure seed-generation logic shared by the CLI (scripts/generate-country-seed.ts)
 * and the regression suite (tests/unit/country-seed-encoding.test.ts).
 *
 * `buildCountrySeedSql` must be byte-identical to the seed block embedded in
 * `supabase/migrations/20260922000000_global_identity_localization.sql`. The
 * regression suite asserts that, which is what "deterministic seed" means
 * here: same canonical data in, same SQL out, forever.
 */

import {
  findEncodingCorruption,
  isCleanUnicode,
} from "./encoding.ts";
import type { CountrySeedRow } from "./data.ts";

export const SEED_INSERT_HEADER =
  "INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)";

/**
 * Canonical display names that must be stored byte-exact in the database.
 * The first five ship inactive for V1 (kept as valid ISO records), the last
 * one stays active.
 */
export const CANONICAL_NAMES: Record<string, string> = {
  AX: "Åland Islands",
  BL: "Saint Barthélemy",
  CW: "Curaçao",
  RE: "Réunion",
  ST: "São Tomé and Príncipe",
  TR: "Türkiye",
};

/** Kept canonical but withheld from V1 launch markets via `active = false`. */
export const V1_INACTIVE_CODES = ["AX", "BL", "CW", "RE", "ST"] as const;

/** Must stay available from day one. */
export const V1_ACTIVE_CODE = "TR";

/** Baseline uninhabited territories, inactive since Phase 1. */
export const BASELINE_INACTIVE_CODES = ["AQ", "BV", "HM", "UM"] as const;

const CODE_RE = /^[A-Z]{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const CALLING_CODE_RE = /^\+[0-9]{1,6}$/;

/** Escapes a value for a PostgreSQL single-quoted literal. */
export function sqlLiteral(value: string | null): string {
  if (value === null) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Renders the seeded dataset as the exact INSERT block the migration embeds:
 * 10 rows per statement, statements sorted by code, no blank lines.
 */
export function buildCountrySeedSql(rows: readonly CountrySeedRow[]): string {
  const sorted = [...rows].sort((a, b) => a.code.localeCompare(b.code));

  const statements: string[] = [];
  for (let i = 0; i < sorted.length; i += 10) {
    const chunk = sorted.slice(i, i + 10);
    const rowsSql = chunk
      .map((row, index) => {
        const fields = [
          sqlLiteral(row.code),
          sqlLiteral(row.name),
          sqlLiteral(row.default_currency),
          sqlLiteral(row.default_locale),
          sqlLiteral(row.calling_code),
          String(row.active),
        ].join(", ");
        const comma = index === chunk.length - 1 ? "" : ",";
        return `  (${fields})${comma}`;
      })
      .join("\n");

    statements.push(`${SEED_INSERT_HEADER}\nVALUES\n${rowsSql}\nON CONFLICT (code) DO NOTHING;`);
  }

  return statements.join("\n");
}

/** Extracts the embedded seed block from a migration file, or null. */
export function extractSeedBlock(sql: string): string | null {
  const start = sql.indexOf(SEED_INSERT_HEADER);
  if (start === -1) return null;
  const end = sql.lastIndexOf("ON CONFLICT (code) DO NOTHING;");
  if (end === -1) return null;
  return sql.slice(start, end + "ON CONFLICT (code) DO NOTHING;".length);
}

/**
 * Validates the canonical dataset end to end. Returns every problem found;
 * an empty array means the dataset is safe to generate from.
 */
export function validateCountryData(
  rows: readonly CountrySeedRow[]
): string[] {
  const issues: string[] = [];

  if (rows.length !== 250) {
    issues.push(`expected 250 rows, got ${rows.length}`);
  }

  const seen = new Map<string, CountrySeedRow>();
  for (const row of rows) {
    const where = (field: string, value: unknown) =>
      `${row.code}.${field} ${JSON.stringify(value)}`;

    if (seen.has(row.code)) {
      issues.push(`duplicate code: ${row.code}`);
    }
    seen.set(row.code, row);

    if (!CODE_RE.test(row.code)) issues.push(where("code", row.code) + " is not ISO alpha-2");
    if (!row.name || row.name.trim() === "") issues.push(where("name", row.name) + " is empty");
    if (!CURRENCY_RE.test(row.default_currency)) issues.push(where("default_currency", row.default_currency));
    if (!LOCALE_RE.test(row.default_locale)) issues.push(where("default_locale", row.default_locale));
    if (row.calling_code !== null && !CALLING_CODE_RE.test(row.calling_code)) {
      issues.push(where("calling_code", row.calling_code));
    }
    if (typeof row.active !== "boolean") issues.push(where("active", row.active));

    for (const field of ["name", "default_currency", "default_locale", "calling_code"] as const) {
      const value = row[field];
      if (value === null) continue;
      const corrupt = findEncodingCorruption(value);
      if (corrupt.length > 0) {
        issues.push(
          `${
            row.code
          }.${field} ${JSON.stringify(value)} has encoding corruption: ${corrupt
            .map((i) => i.kind)
            .join(", ")}`
        );
      }
    }
  }

  // Canonical names must be byte-exact.
  for (const [code, expected] of Object.entries(CANONICAL_NAMES)) {
    const row = seen.get(code);
    if (!row) {
      issues.push(`canonical record ${code} is missing`);
      continue;
    }
    if (row.name !== expected) {
      issues.push(
        `${code} name is ${JSON.stringify(row.name)}, expected ${JSON.stringify(expected)}`
      );
    }
    if (!isCleanUnicode(row.name)) {
      issues.push(`${code} name still contains corruption markers`);
    }
  }

  // Launch-market policy.
  if (seen.get(V1_ACTIVE_CODE)?.active !== true) {
    issues.push(`${V1_ACTIVE_CODE} must remain active for V1`);
  }
  for (const code of V1_INACTIVE_CODES) {
    if (seen.get(code)?.active !== false) {
      issues.push(`${code} must be inactive for V1`);
    }
  }

  const active = rows.filter((r) => r.active).length;
  if (active !== 241) {
    issues.push(`expected 241 active territories, got ${active}`);
  }

  const expectedInactive: ReadonlySet<string> = new Set([
    ...BASELINE_INACTIVE_CODES,
    ...V1_INACTIVE_CODES,
  ]);
  const inactiveCodes = rows.filter((r) => !r.active).map((r) => r.code);
  const extraInactive = inactiveCodes.filter((c) => !expectedInactive.has(c));
  const missingInactive = [...expectedInactive].filter((c) => !inactiveCodes.includes(c));
  if (extraInactive.length > 0) issues.push(`unexpected inactive codes: ${extraInactive.join(", ")}`);
  if (missingInactive.length > 0) issues.push(`missing inactive codes: ${missingInactive.join(", ")}`);

  return issues;
}