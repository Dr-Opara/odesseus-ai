import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/lib/email/send";

const ORIGINAL_KEY = process.env.RESEND_API_KEY;
const ORIGINAL_FROM = process.env.ODESSEUS_PARTNER_FROM_EMAIL;
const ORIGINAL_SITE = process.env.NEXT_PUBLIC_SITE_URL;

function configured() {
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.ODESSEUS_PARTNER_FROM_EMAIL = "Odesseus <hello@example.com>";
  process.env.NEXT_PUBLIC_SITE_URL = "https://odesseus.ai";
}

function payloadOf(fetchMock: ReturnType<typeof vi.fn>) {
  const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(request.body)) as {
    to: string[];
    subject: string;
    html: string;
  };
}

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIGINAL_KEY;

  if (ORIGINAL_FROM === undefined) delete process.env.ODESSEUS_PARTNER_FROM_EMAIL;
  else process.env.ODESSEUS_PARTNER_FROM_EMAIL = ORIGINAL_FROM;

  if (ORIGINAL_SITE === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_SITE;

  vi.unstubAllGlobals();
});

describe("shared email transport", () => {
  it("degrades to not_configured when the key or from address is absent", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.ODESSEUS_PARTNER_FROM_EMAIL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await sendEmail({ to: "a@example.com", subject: "s", heading: "h", body: "b" })).toEqual(
      { sent: false, reason: "not_configured" }
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a blank key as absent", async () => {
    process.env.RESEND_API_KEY = "   ";
    process.env.ODESSEUS_PARTNER_FROM_EMAIL = "Odesseus <hello@example.com>";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // Whitespace is a common way a secret fails to load in a deployment. It must
    // not be sent as an empty bearer token.
    expect(await sendEmail({ to: "a@example.com", subject: "s", heading: "h", body: "b" })).toEqual(
      { sent: false, reason: "not_configured" }
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("escapes caller-supplied content so it cannot inject markup", async () => {
    configured();
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({
      to: "a@example.com",
      subject: "Hi",
      heading: "<script>alert(1)</script>",
      body: '"><img src=x onerror=alert(1)>',
      ctaLabel: "Go",
      ctaHref: 'https://example.com/"><script>alert(1)</script>',
    });

    const payload = payloadOf(fetchMock);
    expect(payload.html).not.toContain("<script>");
    expect(payload.html).not.toContain("<img");
    expect(payload.html).toContain("&lt;script&gt;");
  });

  it("absolutises a relative call to action against the site url", async () => {
    configured();
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({
      to: "a@example.com",
      subject: "s",
      heading: "h",
      body: "b",
      ctaLabel: "Go",
      ctaHref: "/teams",
    });

    expect(payloadOf(fetchMock).html).toContain('href="https://odesseus.ai/teams"');
  });

  it("leaves an absolute call to action alone", async () => {
    configured();
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({
      to: "a@example.com",
      subject: "s",
      heading: "h",
      body: "b",
      ctaLabel: "Go",
      ctaHref: "https://elsewhere.example/x",
    });

    expect(payloadOf(fetchMock).html).toContain('href="https://elsewhere.example/x"');
  });

  it("uses the caller's log prefix so a failure is attributable", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.ODESSEUS_PARTNER_FROM_EMAIL = "Odesseus <hello@example.com>";
    const fetchMock = vi.fn().mockRejectedValue(new Error("connection reset"));
    vi.stubGlobal("fetch", fetchMock);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await sendEmail({ to: "a@example.com", subject: "s", heading: "h", body: "b" });

    // One prefix per caller, so an operator reading a log knows which subsystem
    // reported the failure.
    expect(String(consoleError.mock.calls[0][0])).toContain("[ODESSEUS_EMAIL]");
    expect(String(consoleError.mock.calls[0][0])).not.toContain("[ODESSEUS_PARTNERS]");
    consoleError.mockRestore();
  });

  it("never caches the provider response", async () => {
    configured();
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({ to: "a@example.com", subject: "s", heading: "h", body: "b" });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request.cache).toBe("no-store");
  });
});
