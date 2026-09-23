/**
 * Shared formatting helpers for the pricing API routes.
 *
 * The only role of a locale in this engine is display formatting. A user's
 * `preferred_currency` never changes the amount or currency of a resolved
 * price — only an already-resolved market price is formatted.
 */

const LOCALE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/**
 * Chooses a safe BCP-47 locale for formatting: the caller's profile locale
 * when well-formed, otherwise the resolved market's default locale, otherwise
 * en-US. Malformed locales are never handed to Intl (it throws on them).
 */
export function formatLocaleOrDefault(
  candidate: string | null | undefined,
  marketLocale: string | null | undefined
): string {
  if (candidate && LOCALE_PATTERN.test(candidate)) return candidate;
  if (marketLocale && LOCALE_PATTERN.test(marketLocale)) return marketLocale;
  return "en-US";
}