import { z } from "zod";

/**
 * The only profile columns this module may ever write. Anything else in a
 * request body is discarded before the update is built.
 */
export const LOCALIZATION_FIELDS = [
  "country_code",
  "locale",
  "preferred_currency",
  "timezone",
  "preferred_language",
  "application_contact_email",
] as const;

export type LocalizationField = (typeof LOCALIZATION_FIELDS)[number];
export type LocalizationValues = Record<LocalizationField, string | null>;
export type LocalizationPatch = Partial<LocalizationValues>;

const LOCALE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const TIMEZONE_PATTERN = /^[A-Za-z0-9_+.-]+(\/[A-Za-z0-9_+.-]+)*$/;

/**
 * Trims input, maps blank strings to null (so forms can clear a field), and
 * optionally normalizes casing. Non-string values pass through so the zod
 * type check reports them.
 */
function normalizeText(
  value: unknown,
  transform?: (value: string) => string
): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return transform ? transform(trimmed) : trimmed;
}

/**
 * Validation for the six localization columns. Mirrors the CHECK constraints
 * from migration 20260922000000_global_identity_localization.sql so bad input
 * is rejected with a 400 instead of surfacing a database error.
 *
 * application_contact_email is only ever stored for filling job applications
 * so recruiters can reach the candidate. Odesseus has no mail access, and
 * this module performs no address verification or delivery.
 */
export const localizationSchema = z.object({
  country_code: z.preprocess(
    (value) => normalizeText(value, (v) => v.toUpperCase()),
    z
      .string()
      .regex(/^[A-Z]{2}$/, "Use a two-letter country code.")
      .nullable()
      .optional()
  ),
  locale: z.preprocess(
    (value) => normalizeText(value),
    z
      .string()
      .regex(LOCALE_PATTERN, "Use a locale like en-US.")
      .nullable()
      .optional()
  ),
  preferred_currency: z.preprocess(
    (value) => normalizeText(value, (v) => v.toUpperCase()),
    z
      .string()
      .regex(/^[A-Z]{3}$/, "Use a three-letter currency code.")
      .nullable()
      .optional()
  ),
  timezone: z.preprocess(
    (value) => normalizeText(value),
    z
      .string()
      .max(64, "Time zone name is too long.")
      .regex(TIMEZONE_PATTERN, "Use a time zone like America/Chicago.")
      .nullable()
      .optional()
  ),
  preferred_language: z.preprocess(
    (value) => normalizeText(value, (v) => v.toLowerCase()),
    z
      .string()
      .regex(/^[a-z]{2,3}$/, "Use a two- or three-letter language code.")
      .nullable()
      .optional()
  ),
  application_contact_email: z.preprocess(
    (value) => normalizeText(value),
    z
      .string()
      .max(320, "Email address is too long.")
      .email("Enter a valid email address.")
      .nullable()
      .optional()
  ),
});

export type LocalizationInput = z.infer<typeof localizationSchema>;

/**
 * Parses an untrusted request body and returns an update object containing
 * only whitelisted localization fields that were actually present. Unknown
 * keys (onboarding_completed, full_name, id, ...) are never included.
 *
 * Throws zod's ZodError on invalid input.
 */
export function pickLocalizationFields(payload: unknown): LocalizationPatch {
  const parsed = localizationSchema.parse(payload);
  const update: LocalizationPatch = {};

  for (const field of LOCALIZATION_FIELDS) {
    const value = parsed[field];
    if (value !== undefined) {
      update[field] = value;
    }
  }

  return update;
}

/** All six fields explicitly null — used for GET fallbacks. */
export function emptyLocalization(): LocalizationValues {
  return Object.fromEntries(
    LOCALIZATION_FIELDS.map((field) => [field, null])
  ) as LocalizationValues;
}
