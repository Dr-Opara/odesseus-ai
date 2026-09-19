import { describe, expect, it, vi } from "vitest";
import { isSafeExternalUrl } from "@/lib/security/url-safety";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (hostname: string) => {
    const table: Record<string, { address: string; family: number }[]> = {
      "jobs.example.com": [{ address: "93.184.216.34", family: 4 }],
      "internal.example.com": [{ address: "10.0.0.5", family: 4 }],
      "rebinding.example.com": [{ address: "169.254.169.254", family: 4 }],
      "nowhere.example.com": [],
    };
    const result = table[hostname];
    if (!result) throw new Error("ENOTFOUND");
    return result;
  }),
}));

describe("isSafeExternalUrl", () => {
  it("rejects non-https protocols", async () => {
    const result = await isSafeExternalUrl("http://jobs.example.com/apply");
    expect(result.safe).toBe(false);
  });

  it("rejects malformed URLs", async () => {
    const result = await isSafeExternalUrl("not a url");
    expect(result.safe).toBe(false);
  });

  it("rejects literal loopback/private IPs", async () => {
    expect((await isSafeExternalUrl("https://127.0.0.1/apply")).safe).toBe(false);
    expect((await isSafeExternalUrl("https://10.1.2.3/apply")).safe).toBe(false);
    expect((await isSafeExternalUrl("https://192.168.1.1/apply")).safe).toBe(false);
    expect((await isSafeExternalUrl("https://172.16.0.1/apply")).safe).toBe(false);
  });

  it("rejects the cloud metadata address", async () => {
    expect((await isSafeExternalUrl("https://169.254.169.254/latest/meta-data")).safe).toBe(false);
  });

  it("rejects the literal hostname 'localhost'", async () => {
    expect((await isSafeExternalUrl("https://localhost/apply")).safe).toBe(false);
  });

  it("rejects IPv6 loopback and unique-local addresses", async () => {
    expect((await isSafeExternalUrl("https://[::1]/apply")).safe).toBe(false);
    expect((await isSafeExternalUrl("https://[fd00::1]/apply")).safe).toBe(false);
  });

  it("allows a hostname that resolves only to a public address", async () => {
    const result = await isSafeExternalUrl("https://jobs.example.com/apply");
    expect(result.safe).toBe(true);
  });

  it("rejects a hostname that resolves to a private address (DNS rebinding)", async () => {
    const result = await isSafeExternalUrl("https://internal.example.com/apply");
    expect(result.safe).toBe(false);
  });

  it("rejects a hostname that resolves to the cloud metadata address", async () => {
    const result = await isSafeExternalUrl("https://rebinding.example.com/apply");
    expect(result.safe).toBe(false);
  });

  it("rejects a hostname that fails to resolve", async () => {
    expect((await isSafeExternalUrl("https://does-not-exist.example.com/apply")).safe).toBe(false);
  });

  it("rejects a hostname that resolves to zero addresses", async () => {
    expect((await isSafeExternalUrl("https://nowhere.example.com/apply")).safe).toBe(false);
  });
});
