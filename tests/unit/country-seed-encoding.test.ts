import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  findEncodingCorruption,
  isCleanUnicode,
  repairCp1252Mojibake,
} from "../../scripts/countries/encoding.ts";
import type { EncodingIssueKind } from "../../scripts/countries/encoding.ts";
import {
  CANONICAL_NAMES,
  V1_ACTIVE_CODE,
  V1_INACTIVE_CODES,
  buildCountrySeedSql,
  extractSeedBlock,
  sqlLiteral,
  validateCountryData,
} from "../../scripts/countries/build-seed.ts";
import { COUNTRY_SEED } from "../../scripts/countries/data.ts";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

const MIGRATION = path.join(
  repoRoot,
  "supabase/migrations/20260922000000_global_identity_localization.sql"
);

/** Normalizes CRLF to LF so byte-level comparisons are platform-independent. */
function readMigration(): string {
  return readFileSync(MIGRATION, "utf8").replace(/\r\n/g, "\n");
}

/** The six corrupted forms that actually shipped in Phase 1. */
const SHIPPED_MOJIBAKE = {
  AX: "Ã…land Islands",
  BL: "Saint BarthÃ©lemy",
  CW: "CuraÃ§ao",
  RE: "RÃ©union",
  ST: "SÃ£o TomÃ© and PrÃ­ncipe",
  TR: "TÃ¼rkiye",
} as const;

describe("encoding detector — class-based corruption detection", () => {
  it("flags every one of the six mojibake forms that shipped in Phase 1", () => {
    for (const [code, value] of Object.entries(SHIPPED_MOJIBAKE)) {
      const issues = findEncodingCorruption(value);
      expect(issues.length, `${code} ${value} must be flagged`).toBeGreaterThan(0);
      expect(
        issues.map((issue) => issue.kind),
        `${code} ${value}`
      ).toContain("double-encoded-utf8");
    }
  });

  it("flags the wider corruption class, not just the six known strings", () => {
    const corruptSamples: Array<[string, EncodingIssueKind]> = [
      ["Ã¼", "double-encoded-utf8"], // ü
      ["Ã©", "double-encoded-utf8"], // é
      ["Ã§", "double-encoded-utf8"], // ç
      ["Ã£", "double-encoded-utf8"], // ã
      ["Ã­", "double-encoded-utf8"], // í
      ["Ã¤", "double-encoded-utf8"], // ä
      ["Ã¶", "double-encoded-utf8"], // ö
      ["Â°C", "double-encoded-utf8"], // °
      ["PrÃ­ncipe", "double-encoded-utf8"],
      ["CrÃ¨me BrÃ»lÃ©e", "double-encoded-utf8"], // è û
      ["Saint-BarthÃ©lemy", "double-encoded-utf8"],
      ["NÃ¼rnberg", "double-encoded-utf8"],
      ["â€™", "cp1252-token"], // ’ via double mojibake
      ["â€œ", "cp1252-token"], // “
      ["\ufffd", "replacement-char"],
      ["cougar\ud800", "lone-surrogate"],
      ["line\u0001break", "control-char"],
      ["e\u0301clair", "not-nfc"], // decomposed é (NFD)
      ["\ufeffTürkiye", "bom-in-content"],
    ] as const;

    for (const [sample, expectedKind] of corruptSamples) {
      const kinds = findEncodingCorruption(sample).map((issue) => issue.kind);
      expect(
        kinds,
        `${JSON.stringify(sample)} must be flagged as ${expectedKind}`
      ).toContain(expectedKind);
    }
  });

  it("accepts the canonical names and ordinary international text", () => {
    for (const name of [
      ...Object.values(CANONICAL_NAMES),
      "Côte d'Ivoire",
      "Español",
      "Deutsch",
      "København",
      "中国",
      "العربية",
      "Saint Helena, Ascension and Tristan da Cunha",
    ]) {
      expect(isCleanUnicode(name), JSON.stringify(name)).toBe(true);
      expect(findEncodingCorruption(name), JSON.stringify(name)).toEqual([]);
    }
  });
});

describe("mojibake repair — one-time correction path", () => {
  it("reverses the double-encoding for all six shipped values", () => {
    const expected = CANONICAL_NAMES;
    for (const [code, corrupted] of Object.entries(SHIPPED_MOJIBAKE)) {
      expect(repairCp1252Mojibake(corrupted), code).toBe(expected[code]);
    }
  });

  it("passes ASCII-only clean text through unchanged", () => {
    expect(repairCp1252Mojibake("United States")).toBe("United States");
    expect(repairCp1252Mojibake("Ivory Coast")).toBe("Ivory Coast");
  });

  it("produces clean, NFC output for every repaired value", () => {
    for (const corrupted of Object.values(SHIPPED_MOJIBAKE)) {
      const repaired = repairCp1252Mojibake(corrupted);
      expect(findEncodingCorruption(repaired)).toEqual([]);
      expect(repaired).toBe(repaired.normalize("NFC"));
    }
  });

  it("throws on characters that cannot be CP1252 bytes", () => {
    expect(() => repairCp1252Mojibake("界")).toThrow(/no CP1252 byte mapping/);
  });
});

describe("country seed pipeline — committed migration integrity", () => {
  const migrationSql = readMigration();

  it("reports no problems on the canonical dataset", () => {
    expect(validateCountryData(COUNTRY_SEED)).toEqual([]);
  });

  it("is deterministic: same data in, byte-identical SQL out", () => {
    const first = buildCountrySeedSql(COUNTRY_SEED);
    const reversed = buildCountrySeedSql([...COUNTRY_SEED].reverse()); // order-independent
    expect(reversed).toBe(first);
  });

  it("committed seed block is byte-identical to generator output", () => {
    const embedded = extractSeedBlock(migrationSql);
    expect(embedded, "seed block must exist in the migration").not.toBeNull();
    expect(embedded).toBe(buildCountrySeedSql(COUNTRY_SEED));
  });

  it("seeds exactly 250 records with unique ISO alpha-2 codes", () => {
    const codes = [...migrationSql.matchAll(/\('([A-Z]{2})',/g)].map((m) => m[1]);
    expect(codes.length).toBe(250);
    expect(new Set(codes).size).toBe(250);
  });

  it("leaves every committed name, currency, and locale free of corruption", () => {
    const rowRe =
      /^  \('([A-Z]{2})', '([^']*)', '([A-Z]{3})', '([^']*)', (NULL|'\+[0-9]{1,6}'), (true|false)\),?$/gm;
    let rows = 0;
    for (const match of migrationSql.matchAll(rowRe)) {
      rows += 1;
      const [, code, name, currency, locale, calling] = match;
      const fields: Array<[string, string]> = [
        ["name", name],
        ["default_currency", currency],
        ["default_locale", locale],
        ["calling_code", calling === "NULL" ? "" : calling.slice(1, -1)],
      ];
      for (const [field, value] of fields) {
        expect(
          findEncodingCorruption(value),
          `${code}.${field} must be clean`
        ).toEqual([]);
      }
    }
    expect(rows).toBe(250);
  });

  it("returns 241 active territories", () => {
    const active = [...migrationSql.matchAll(/, true\)/g)].length;
    const inactive = [...migrationSql.matchAll(/, false\)/g)].length;
    expect(active + inactive).toBe(250);
    expect(active).toBe(241);
  });
});

describe("launch-market policy in the committed migration", () => {
  const migrationSql = readMigration();

  it("stores the six canonical names byte-exact", () => {
    for (const [code, expected] of Object.entries(CANONICAL_NAMES)) {
      const row = migrationSql.match(
        new RegExp(`^  \\('${code}', '([^']*)',.*`, "m")
      )?.[1];
      expect(row, `${code} row`).toBe(expected);
    }
  });

  it("keeps TR active and withholds AX/BL/CW/RE/ST for V1", () => {
    for (const code of V1_INACTIVE_CODES) {
      const row = migrationSql.match(
        new RegExp(
          `^  \\('${code}', '[^']*', '[A-Z]{3}', '[^']*', (NULL|'\\+[0-9]{1,6}'), (true|false)\\),?$`,
          "m"
        )
      )?.[0];
      expect(row, `${code} row`).not.toBeUndefined();
      const activeFlag = row?.match(/, (true|false)\),?$/)?.[1];
      expect(activeFlag, `${code} must be inactive for V1`).toBe("false");
    }

    const trRow = migrationSql.match(
      new RegExp(
        `^  \\('${V1_ACTIVE_CODE}', '[^']*', '[A-Z]{3}', '[^']*', (NULL|'\\+[0-9]{1,6}'), (true|false)\\),?$`,
        "m"
      )
    )?.[0];
    expect(trRow, "TR row").not.toBeUndefined();

    // Narrow the TR row to its actual boolean to be unambiguous.
    const trActive = trRow?.match(/, (true|false)\),?$/)?.[1];
    expect(trActive, "TR active flag").toBe("true");
  });

  it("keeps every one of the five withheld records in the dataset", () => {
    for (const code of V1_INACTIVE_CODES) {
      expect(
        migrationSql.match(new RegExp(`^  \\('${code}', '${CANONICAL_NAMES[code]}',`, "m")),
        `${code} must still exist with its canonical name`
      ).not.toBeNull();
    }
  });
});

describe("generator helpers", () => {
  it("sorts by code regardless of input order", () => {
    const reversed = [...COUNTRY_SEED].sort((a, b) => b.code.localeCompare(a.code));
    const codes = buildCountrySeedSql(reversed)
      .match(/\('([A-Z]{2})', '/g)!
      .map((token) => token.slice(2, 4));
    expect(codes).toEqual([...codes].sort());
  });

  it("escapes single quotes in SQL literals", () => {
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'");
    expect(sqlLiteral(null)).toBe("NULL");
  });
});