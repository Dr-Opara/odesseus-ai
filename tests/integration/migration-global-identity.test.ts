import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

const MIGRATION =
  "supabase/migrations/20260922000000_global_identity_localization.sql";
const BASELINE =
  "supabase/migrations/20260918180133_baseline_v0_11.sql";

const sql = readFileSync(path.join(repoRoot, MIGRATION), "utf8");
const baseline = readFileSync(path.join(repoRoot, BASELINE), "utf8");

const NEW_PROFILE_COLUMNS = [
  "country_code",
  "locale",
  "preferred_currency",
  "timezone",
  "preferred_language",
  "application_contact_email",
];

const PROFILE_CHECKS = [
  "profiles_country_code_check",
  "profiles_locale_check",
  "profiles_preferred_currency_check",
  "profiles_timezone_check",
  "profiles_preferred_language_check",
  "profiles_application_contact_email_check",
];

const COUNTRY_COLUMNS = [
  "code",
  "name",
  "default_currency",
  "default_locale",
  "calling_code",
  "active",
  "created_at",
  "updated_at",
];

/** Splits a SQL script into statements, ignoring `--` comment lines. */
function executableStatements(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/** The ADD COLUMN clause for one column, up to the next statement. */
function addColumnClause(column: string): string {
  const needle = `ADD COLUMN IF NOT EXISTS ${column} text`;
  const start = sql.indexOf(needle);
  expect(start, `missing ${needle}`).toBeGreaterThan(-1);
  const rest = sql.slice(start);
  const end = rest.search(/ADD COLUMN IF NOT EXISTS|ALTER TABLE|CREATE INDEX/);
  return end === -1 ? rest : rest.slice(0, end);
}

describe("global identity migration — static SQL review", () => {
  it("is purely additive: no drops, deletes, truncates, or column rewrites", () => {
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bALTER\s+COLUMN\b/i);
    expect(sql).not.toMatch(/\bSET\s+NOT\s+NULL\b/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.profiles/i);
  });

  it("adds all six localization columns as nullable text with no defaults", () => {
    for (const column of NEW_PROFILE_COLUMNS) {
      const clause = addColumnClause(column);
      expect(clause, `${column} must be nullable`).not.toMatch(/\bNOT NULL\b/);
      expect(clause, `${column} must not invent a default`).not.toMatch(
        /\bDEFAULT\b/
      );
    }
  });

  it("preserves the legacy free-text location column untouched", () => {
    expect(sql).toContain("profiles.location");
    expect(sql).not.toMatch(/DROP\s+COLUMN\s+location/i);
    expect(sql).not.toMatch(/ALTER\s+COLUMN\s+location/i);
    // Old location values are never parsed or migrated into country_code:
    expect(sql).not.toMatch(/UPDATE\s+public\.profiles/i);
  });

  it("creates the canonical countries table with exactly the eight columns", () => {
    const createMatch = sql.match(
      /CREATE TABLE IF NOT EXISTS public\.countries \(([\s\S]*?)\n\);/
    );
    expect(createMatch).not.toBeNull();

    const body = createMatch![1];
    const columnLines = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith('"'));

    expect(columnLines.map((line) => line.slice(1).split('"')[0])).toEqual(
      COUNTRY_COLUMNS
    );
    // No pin/priority/sort column exists — pinning is frontend-only.
    expect(body).not.toMatch(
      /pinned|priority|featured|sort_order|display_order|region/i
    );
  });

  it("enforces ISO alpha-2 codes, currency, and locale at the database", () => {
    expect(sql).toMatch(
      /CONSTRAINT "countries_code_check" CHECK \("code" ~ '\^\[A-Z\]\{2\}\$'\)/
    );
    expect(sql).toMatch(/"default_currency" ~ '\^\[A-Z\]\{3\}\$'/);
    expect(sql).toMatch(
      /"default_locale" ~ '\^\[a-z\]\{2,3\}\(-\[A-Za-z0-9\]\{2,8\}\)\*\$'/
    );
  });

  it("adds a foreign key and six format checks on profiles", () => {
    expect(sql).toContain('CONSTRAINT "profiles_country_code_fkey"');
    expect(sql).toContain('REFERENCES public.countries ("code")');
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS "profiles_country_code_idx"'
    );
    for (const check of PROFILE_CHECKS) {
      expect(sql).toContain(check);
    }
    expect(sql).toMatch(
      /application_contact_email ~ '\^\[\^@\[:space:\]\]\+@\[\^@\[:space:\]\]\+\\\.\[\^@\[:space:\]\]\+\$'/
    );
  });

  it("enables RLS on countries with a single public SELECT policy", () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.countries ENABLE ROW LEVEL SECURITY/
    );

    const policies = executableStatements(sql).filter((statement) =>
      /CREATE POLICY/i.test(statement)
    );

    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/ON public\.countries/);
    expect(policies[0]).toMatch(/FOR SELECT/);
    expect(policies[0]).toMatch(/TO anon, authenticated/);
    expect(policies[0]).toMatch(/USING \(true\)/);
    expect(sql).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE)\b/i);
  });

  it("scopes grants: clients can read countries, only servers can write", () => {
    expect(sql).toContain(
      "REVOKE ALL ON TABLE public.countries FROM anon;"
    );
    expect(sql).toContain(
      "REVOKE ALL ON TABLE public.countries FROM authenticated;"
    );
    expect(sql).toContain(
      "GRANT SELECT ON TABLE public.countries TO anon, authenticated;"
    );
    // No DML grant ever reaches anon or authenticated:
    expect(sql).not.toMatch(
      /GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*countries[^;]*(anon|authenticated)/i
    );
  });

  it("never creates, alters, or drops a profile policy (privacy unchanged)", () => {
    for (const statement of executableStatements(sql)) {
      if (/(CREATE|ALTER|DROP)\s+POLICY/i.test(statement)) {
        expect(statement).toMatch(/countries/);
        expect(statement).not.toMatch(/profiles/);
      }
    }
    // The baseline owner-only policies and the anon revoke stay in place:
    expect(baseline).toContain('CREATE POLICY "profiles_select_own"');
    expect(baseline).toContain('CREATE POLICY "profiles_update_own"');
    expect(baseline).toContain('CREATE POLICY "profiles_insert_own"');
    expect(baseline).toContain('CREATE POLICY "profiles_delete_own"');
    expect(baseline).toContain(
      'REVOKE ALL ON TABLE "public"."profiles" FROM "anon";'
    );
  });

  it("seeds a global dataset without duplicate codes", () => {
    const codes = [...sql.matchAll(/\('([A-Z]{2})',/g)].map(
      (match) => match[1]
    );

    expect(codes.length).toBeGreaterThanOrEqual(240);
    expect(new Set(codes).size).toBe(codes.length);

    for (const code of [
      "US",
      "GB",
      "CA",
      "NG",
      "IN",
      "JP",
      "BR",
      "AU",
      "ZA",
      "DE",
      "CN",
      "MX",
      "AE",
    ]) {
      expect(codes, `expected ${code} in the dataset`).toContain(code);
    }
  });

  it("stores no US/GB/CA special-casing in the database", () => {
    expect(sql).not.toMatch(
      /\b(pinned|priority|featured|sort_order|display_order)\b/i
    );
    expect(sql).not.toMatch(/code\s+IN\s*\(\s*'(US|GB|CA)'/i);
    expect(sql).not.toMatch(/CASE\s+WHEN/i);

    const uniformRow =
      /^\('[A-Z]{2}', '[^']*', '[A-Z]{3}', '[a-z]{2,3}(-[A-Za-z0-9]{2,8})*', '\+[0-9]{1,6}', (true|false)\),?$/;

    // Pinned and unpinned countries share the exact same row shape.
    for (const code of ["US", "GB", "CA", "NG", "IN", "JP"]) {
      const row = sql
        .match(new RegExp(`^\\s*\\('${code}',[^\\n]*`, "m"))?.[0]
        .trim();
      expect(row, `${code} row shape`).toMatch(uniformRow);
    }
  });

  it("introduces no mail or message-reading capability in any Phase 1 file", () => {
    const phase1Files = [
      MIGRATION,
      "src/lib/profile/localization.ts",
      "src/lib/countries/service.ts",
      "src/lib/countries/picker.ts",
      "src/app/api/countries/route.ts",
      "src/app/api/profile/localization/route.ts",
      "src/components/localization-form.tsx",
    ];

    const banned =
      /\b(imap|pop3|gmail|inbox|oauth|mailparser|nodemailer|smtp)\b/i;

    for (const file of phase1Files) {
      const content = readFileSync(path.join(repoRoot, file), "utf8");
      expect(banned.test(content), `${file} must stay mail-access free`).toBe(
        false
      );
    }
  });

  it("keeps the service-role key out of every client component", () => {
    const srcDir = path.join(repoRoot, "src");
    const files = readdirSync(srcDir, { recursive: true }) as string[];

    for (const relative of files) {
      if (!/\.(ts|tsx)$/.test(relative)) continue;
      const content = readFileSync(path.join(srcDir, relative), "utf8");
      if (!content.startsWith('"use client"')) continue;
      expect(
        /supabase\/service|SUPABASE_SERVICE_ROLE_KEY/.test(content),
        `${relative} is a client component and must not use the service role`
      ).toBe(false);
    }
  });
});
