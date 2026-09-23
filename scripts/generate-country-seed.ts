/**
 * Country seed generator / verifier CLI.
 *
 * Usage:
 *   node scripts/generate-country-seed.ts            validate canonical data
 *   node scripts/generate-country-seed.ts --check    ...and compare against the
 *                                                    committed migration block
 *   node scripts/generate-country-seed.ts --write    regenerate the migration's
 *                                                    seed block from data.ts
 *
 * The generator never repairs input silently. Anything the encoding detector
 * flags fails the run, so corrupted names can only land in the seed through a
 * deliberate fix of the canonical data (scripts/countries/data.ts).
 *
 * Determinism: `buildCountrySeedSql` sorts by code and renders a fixed
 * 10-rows-per-statement format, so the same data always yields the same SQL.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COUNTRY_SEED } from "./countries/data.ts";
import {
  buildCountrySeedSql,
  extractSeedBlock,
  validateCountryData,
} from "./countries/build-seed.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION = path.join(
  repoRoot,
  "supabase/migrations/20260922000000_global_identity_localization.sql"
);

type Mode = "validate" | "check" | "write";

function parseArgs(argv: string[]): Mode {
  if (argv.includes("--write")) return "write";
  if (argv.includes("--check")) return "check";
  return "validate";
}

function run(): void {
  const mode = parseArgs(process.argv.slice(2));

  const issues = validateCountryData(COUNTRY_SEED);
  if (issues.length > 0) {
    console.error("Country seed validation FAILED:");
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exitCode = 1;
    return;
  }

  const built = buildCountrySeedSql(COUNTRY_SEED);
  const rows = COUNTRY_SEED.length;
  const active = COUNTRY_SEED.filter((r) => r.active).length;
  console.log(
    `canonical data: ${rows} rows, ${active} active, ${rows - active} inactive — clean`
  );

  if (mode === "validate") return;

  const migrationSql = readFileSync(MIGRATION, "utf8").replace(/\r\n/g, "\n");
  const embedded = extractSeedBlock(migrationSql);
  if (embedded === null) {
    console.error("Could not locate the seed block in the migration.");
    process.exitCode = 1;
    return;
  }

  if (embedded === built) {
    console.log("committed migration seed block matches generator output exactly.");
    return;
  }

  if (mode === "check") {
    console.error("MIGRATION DRIFT: the committed seed block differs from generator output.");
    console.error("Run: npm run countries:generate");
    process.exitCode = 1;
    return;
  }

  // mode === "write"
  const start = migrationSql.indexOf("INSERT INTO public.countries");
  const endMarker = "ON CONFLICT (code) DO NOTHING;";
  const end = migrationSql.lastIndexOf(endMarker);
  if (start === -1 || end === -1) {
    console.error("Could not locate the seed block boundaries in the migration.");
    process.exitCode = 1;
    return;
  }

  const next = migrationSql.slice(end + endMarker.length);
  const rewritten =
    migrationSql.slice(0, start) + built + next;

  writeFileSync(MIGRATION, rewritten, "utf8");
  console.log("regenerated the migration seed block from canonical data.");
}

run();