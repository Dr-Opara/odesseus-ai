import { afterEach, describe, expect, it, vi } from "vitest";
import { sendPartnerEmail } from "@/lib/partners/email";

const originalKey = process.env.RESEND_API_KEY;
const originalFrom = process.env.ODESSEUS_PARTNER_FROM_EMAIL;

afterEach(() => {
  if (originalKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalKey;

  if (originalFrom === undefined) delete process.env.ODESSEUS_PARTNER_FROM_EMAIL;
  else process.env.ODESSEUS_PARTNER_FROM_EMAIL = originalFrom;

  vi.unstubAllGlobals();
});

describe("Partner Program email delivery", () => {
  it("degrades gracefully when email delivery is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.ODESSEUS_PARTNER_FROM_EMAIL;

    const result = await sendPartnerEmail({
      to: "creator@example.com",
      subject: "Test",
      heading: "Hello",
      body: "Body",
    });

    expect(result).toEqual({ sent: false, reason: "not_configured" });
  });

  it("sends through Resend when configured", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.ODESSEUS_PARTNER_FROM_EMAIL = "Odesseus Partners <partners@example.com>";

    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendPartnerEmail({
      to: "creator@example.com",
      subject: "Approved",
      heading: "You are approved.",
      body: "Welcome.",
      ctaLabel: "Dashboard",
      ctaHref: "/partners/dashboard",
    });

    expect(result).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(request.body));
    expect(payload.to).toEqual(["creator@example.com"]);
    expect(payload.subject).toBe("Approved");
    expect(payload.html).toContain("/partners/dashboard");
  });
});
