import { describe, expect, it } from "vitest";
import { makeReferralCode } from "@/lib/partners/service";

describe("Partner Program referral codes", () => {
  it("creates uppercase URL-safe referral codes", () => {
    const code = makeReferralCode("Jane Doe");
    expect(code).toMatch(/^JANEDOE[A-Z0-9]{6}$/);
  });

  it("falls back to a generic stem when the name has no ASCII letters or numbers", () => {
    const code = makeReferralCode("***");
    expect(code).toMatch(/^PARTNER[A-Z0-9]{6}$/);
  });

  it("does not place whitespace or punctuation in the referral code", () => {
    const code = makeReferralCode("A.C. Creator!");
    expect(code).toMatch(/^[A-Z0-9]+$/);
  });
});
