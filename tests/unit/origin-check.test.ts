import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { isTrustedOrigin } from "@/lib/security/origin-check";

describe("isTrustedOrigin", () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://getodesseus.ai";
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = original;
  });

  it("allows a request with no Origin header (non-CORS same-origin request)", () => {
    const request = new Request("https://getodesseus.ai/api/apply/start", { method: "POST" });
    expect(isTrustedOrigin(request)).toBe(true);
  });

  it("allows a request whose Origin matches the configured site URL", () => {
    const request = new Request("https://getodesseus.ai/api/apply/start", {
      method: "POST",
      headers: { origin: "https://getodesseus.ai" },
    });
    expect(isTrustedOrigin(request)).toBe(true);
  });

  it("rejects a request from a different origin", () => {
    const request = new Request("https://getodesseus.ai/api/apply/start", {
      method: "POST",
      headers: { origin: "https://evil.example.com" },
    });
    expect(isTrustedOrigin(request)).toBe(false);
  });

  it("rejects a cross-origin request even when NEXT_PUBLIC_SITE_URL is unset", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const request = new Request("https://getodesseus.ai/api/apply/start", {
      method: "POST",
      headers: { origin: "https://evil.example.com" },
    });
    expect(isTrustedOrigin(request)).toBe(false);
  });
});
