import { describe, expect, it } from "vitest";
import {
  currencyDecimalDigits,
  formatLocalizedPrice,
} from "@/lib/pricing/format";

describe("currencyDecimalDigits", () => {
  it("uses two decimal digits for standard currencies", () => {
    expect(currencyDecimalDigits("USD", "en-US")).toBe(2);
    expect(currencyDecimalDigits("GBP", "en-GB")).toBe(2);
    expect(currencyDecimalDigits("EUR", "en-IE")).toBe(2);
    expect(currencyDecimalDigits("NGN", "en-NG")).toBe(2);
  });

  it("resolves JPY to zero decimal digits (zero-decimal currency)", () => {
    expect(currencyDecimalDigits("JPY", "ja-JP")).toBe(0);
    expect(currencyDecimalDigits("JPY", "en-US")).toBe(0);
  });

  it("always returns an integer digit count", () => {
    for (const currency of ["USD", "GBP", "CAD", "NGN", "GHS", "KES", "ZAR", "AUD", "JPY"]) {
      expect(Number.isInteger(currencyDecimalDigits(currency))).toBe(true);
    }
  });

  it("falls back to 2 digits for an unusable currency instead of throwing", () => {
    expect(currencyDecimalDigits("", "en-US")).toBe(2);
  });
});

describe("formatLocalizedPrice", () => {
  it("formats USD minor units with a dollar sign and two decimals", () => {
    expect(formatLocalizedPrice(2499, "USD", "en-US")).toBe("$24.99");
    expect(formatLocalizedPrice(99, "USD", "en-US")).toBe("$0.99");
  });

  it("formats GBP minor units", () => {
    expect(formatLocalizedPrice(2499, "GBP", "en-GB")).toBe("£24.99");
  });

  it("formats EUR minor units", () => {
    expect(formatLocalizedPrice(2499, "EUR", "en-IE")).toBe("€24.99");
  });

  it("formats NGN minor units with thousands separators", () => {
    expect(formatLocalizedPrice(150000, "NGN", "en-NG")).toBe("₦1,500.00");
  });

  it("formats JPY with zero decimal digits", () => {
    const formatted = formatLocalizedPrice(2500, "JPY", "ja-JP");
    expect(formatted).toMatch(/2,500/);
    expect(formatted).not.toContain(".");
    expect(formatted).not.toContain(".00");
  });

  it("keeps large amounts exact (no floating-point drift)", () => {
    expect(formatLocalizedPrice(123456789, "USD", "en-US")).toBe(
      "$1,234,567.89"
    );
  });

  it("handles pack-sized amounts", () => {
    expect(formatLocalizedPrice(49900, "USD", "en-US")).toBe("$499.00");
    expect(formatLocalizedPrice(2000, "USD", "en-US")).toBe("$20.00");
  });

  it("rejects negative or non-integer minor units", () => {
    expect(() => formatLocalizedPrice(-1, "USD", "en-US")).toThrow();
    expect(() => formatLocalizedPrice(24.99, "USD", "en-US")).toThrow();
  });
});