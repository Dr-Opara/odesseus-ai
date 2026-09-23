/**
 * Encoding-integrity helpers for the country seed pipeline.
 *
 * History: the first country dataset was produced by a pipeline that decoded
 * UTF-8 bytes as Windows-1252 one extra time, which double-encodes every
 * non-ASCII name (this is the classic "mojibake" corruption: `Türkiye`
 * became `TÃ¼rkiye`, `Åland Islands` became `Ã…land Islands`, ...). Six names
 * shipped that way. Those values were repaired and the dataset was committed
 * clean (see scripts/countries/data.ts), but the generator and tests still
 * run every value through this module so the corruption class can never come
 * back unnoticed.
 *
 * Everything here is pure ESM with no dependencies so both the Node CLI
 * (scripts/generate-country-seed.ts) and the Vitest regression suite share
 * the exact same code paths.
 */

export type EncodingIssueKind =
  | "replacement-char" // U+FFFD — a byte could not be decoded
  | "control-char" // C0/C1 controls leak through a mis-decoded stream
  | "lone-surrogate" // a broken surrogate pair inside the string
  | "double-encoded-utf8" // UTF-8 bytes re-decoded as CP1252 (Ã / Â prefixes)
  | "cp1252-token" // recognizable CP1252 mojibake runs (â€…, ï»¿)
  | "bom-in-content" // a UTF-8 BOM that is not at the start of the file
  | "not-nfc"; // canonical-form drift (decomposed accents, manual edits)

export interface EncodingIssue {
  kind: EncodingIssueKind;
  message: string;
  /** 0-based character index of the first offending position. */
  index: number;
}

/**
 * Characters Windows-1252 maps bytes 0x80..0x9F onto. When one of these (or a
 * bare U+00A0..U+00FF) follows `Ã`/`Â`, the text went through the UTF-8-as-
 * CP1252 double-encoding at least once.
 */
const CP1252_HIGH_CHARS = new Set<number>([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
  0x0080, 0x0081, 0x0082, 0x0083, 0x0084, 0x0085, 0x0086, 0x0087, 0x0088,
  0x0089, 0x008a, 0x008b, 0x008c, 0x008e, 0x0091, 0x0092, 0x0093, 0x0094,
  0x0095, 0x0096, 0x0097, 0x0098, 0x0099, 0x009a, 0x009b, 0x009c, 0x009e,
  0x009f,
]);

const DOUBLE_ENCODING_PREFIXES = new Set<string>(["\u00c3", "\u00c2"]); // Ã, Â

/** Looks like a byte that was re-decoded as CP1252 (0x80..0xFF or a 0x80..0x9F alias). */
function looksLikeMisDecodedByte(code: number): boolean {
  return (
    (code >= 0x0080 && code <= 0x00ff) || CP1252_HIGH_CHARS.has(code)
  );
}

function isDisallowedControl(code: number): boolean {
  // C0 controls (except \t \n \r) and all of C1 (0x80..0x9F) leak from mis-
  // decoded binary streams and never belong in display text.
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/**
 * Scans a string and reports every encoding-corruption pattern it can find.
 * Returns an empty array for clean, well-formed, NFC-normalized text.
 */
export function findEncodingCorruption(value: string): EncodingIssue[] {
  const issues: EncodingIssue[] = [];

  if (value.includes("\ufffd")) {
    issues.push({
      kind: "replacement-char",
      message: "contains U+FFFD (�): a byte failed to decode as text",
      index: value.indexOf("\ufffd"),
    });
  }

  if (value.includes("\u2060") || value.includes("\ufeff")) {
    const ch = value.includes("\ufeff") ? "\ufeff" : "\u2060";
    issues.push({
      kind: "bom-in-content",
      message: "contains a byte-order mark only valid at the very start of a stream",
      index: value.indexOf(ch),
    });
  }

  // Whole-token catches for the "double mojibake" family (â€... runs) and the
  // raw source-signature of a UTF-8 BOM mis-decoded as CP1252 (ï»¿).
  const token = value.match(/[\u00e2\u00c3\u00c2][\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d]/u);
  if (token) {
    issues.push({
      kind: "cp1252-token",
      message: "found a CP1252 mojibake run (e.g. â€… / ï»¿ / Ã…): UTF-8 bytes were decoded twice",
      index: token.index ?? 0,
    });
  }

  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);

    if (isDisallowedControl(code)) {
      issues.push({
        kind: "control-char",
        message: `contains control character U+${code.toString(16).toUpperCase().padStart(4, "0")}`,
        index: i,
      });
    }

    if (code >= 0xd800 && code <= 0xdbff) {
      const hasLow = i + 1 < value.length;
      const next = value.charCodeAt(i + 1);
      const isPaired = hasLow && next >= 0xdc00 && next <= 0xdfff;
      if (!isPaired) {
        issues.push({
          kind: "lone-surrogate",
          message: "contains an unpaired high surrogate",
          index: i,
        });
      }
      i += 1; // skip the paired low surrogate we just validated
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      issues.push({
        kind: "lone-surrogate",
        message: "contains an unpaired low surrogate",
        index: i,
      });
    }

    const ch = value[i];
    if (DOUBLE_ENCODING_PREFIXES.has(ch)) {
      const next = value.charCodeAt(i + 1);
      if (looksLikeMisDecodedByte(next)) {
        issues.push({
          kind: "double-encoded-utf8",
          message:
            "found a double-encoded UTF-8 byte (Ã/Â followed by a mis-decoded high byte); " +
            "the value must be re-encoded before it can be trusted",
          index: i,
        });
      } else {
        // A bare Ã/Â in display text has no legitimate use in this dataset;
        // it is almost always a truncated mojibake fragment.
        issues.push({
          kind: "double-encoded-utf8",
          message: "found a stray Ã or Â that is not paired with a mis-decoded byte",
          index: i,
        });
      }
    }
  }

  if (value !== value.normalize("NFC")) {
    issues.push({
      kind: "not-nfc",
      message: "text is not in NFC canonical form; accents may be decomposed or hand-edited",
      index: 0,
    });
  }

  return issues;
}

/** True when `value` shows no encoding-corruption pattern at all. */
export function isCleanUnicode(value: string): boolean {
  return findEncodingCorruption(value).length === 0;
}

/**
 * Reverses the UTF-8-read-as-CP1252 double-encoding (one extra decode).
 *
 * Correction path: re-encode the current characters as CP1252 bytes, then
 * decode those bytes once as UTF-8. Non-ASCII sequences produce their original
 * characters; characters that are already correct ASCII/Latin-1 pass through
 * unchanged.
 *
 * This is a one-time data repair for the seed pipeline. The generator refuses
 * to write anything the detector flags; it never silently repairs.
 */
export function repairCp1252Mojibake(value: string): string {
  // CP1252 byte 0x80..0x9F -> UTF-16 character.
  const cp1252CharToByte = new Map<number, number>([
    [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
    [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
    [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
    [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
    [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
    [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
    [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
  ]);

  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code > 0xff && !cp1252CharToByte.has(code)) {
      throw new Error(
        `Cannot repair: character U+${code
          .toString(16)
          .toUpperCase()} has no CP1252 byte mapping. ` +
          "Only UTF-8-read-as-CP1252 mojibake can be repaired."
      );
    }
    bytes[i] = cp1252CharToByte.get(code) ?? code;
  }

  // fatal: throw instead of silently emitting U+FFFD if the bytes are invalid.
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}