/**
 * Standards-based currency formatting for the pricing engine.
 *
 * Two rules keep money honest here:
 *   1. Amounts are always integers in the currency's minor units — never
 *      floats, never exchanged/derived in the browser.
 *   2. Display formatting goes through `Intl.NumberFormat`, never hand-built
 *      "$" concatenation. That correctly handles zero-decimal currencies
 *      such as JPY as well as currencies with 2 decimal digits.
 */

/** @internal Cache of resolved fraction digits per (currency, locale). */
const digitsCache = new Map<string, number>();

/**
 * Number of decimal digits for a currency in a given formatting locale.
 * JPY (and other zero-decimal currencies) resolve to 0; the default is 2.
 * Falls back to 2 for unknown/unusable currency codes so formatting never
 * crashes on malformed data.
 */
export function currencyDecimalDigits(
  currency: string,
  locale = "en-US"
): number {
  const key = `${currency}:${locale}`;
  const cached = digitsCache.get(key);
  if (cached !== undefined) return cached;

  let digits = 2;
  try {
    const resolved = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).resolvedOptions();
    if (typeof resolved.maximumFractionDigits === "number") {
      digits = resolved.maximumFractionDigits;
    }
  } catch {
    digits = 2;
  }
  digitsCache.set(key, digits);
  return digits;
}

/**
 * Formats an integer minor-unit amount as a localized currency string.
 *
 * The integer is split into major/fraction parts and recombined as a string
 * before being handed to Intl, so large amounts never drift through floating
 * point. Examples: (2499, "USD", "en-US") → "$24.99";
 * (2500, "JPY", "ja-JP") → "￥2,500" (zero decimal digits).
 */
export function formatLocalizedPrice(
  amountMinor: number,
  currency: string,
  locale = "en-US"
): string {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new Error(`amount_minor must be a non-negative integer, got ${amountMinor}`);
  }

  const options: Intl.NumberFormatOptions = { style: "currency", currency };
  const digits = currencyDecimalDigits(currency, locale);

  let major: number;
  if (digits === 0) {
    major = amountMinor;
  } else {
    const divisor = 10 ** digits;
    const integerPart = Math.floor(amountMinor / divisor);
    const fraction = String(amountMinor % divisor).padStart(digits, "0");
    major = Number(`${integerPart}.${fraction}`);
  }

  return new Intl.NumberFormat(locale, options).format(major);
}