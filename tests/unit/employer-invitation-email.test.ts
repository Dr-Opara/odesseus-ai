import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INVITATION_REDEEM_PATH,
  buildInvitationLink,
  buildInvitationMessage,
  sendInvitationEmail,
} from "@/lib/employer/invitation-email";

const ORIGINAL_KEY = process.env.RESEND_API_KEY;
const ORIGINAL_FROM = process.env.ODESSEUS_PARTNER_FROM_EMAIL;
const ORIGINAL_SITE = process.env.NEXT_PUBLIC_SITE_URL;

const NOW = new Date("2026-10-01T00:00:00.000Z");
const SEVEN_DAYS_OUT = new Date("2026-10-08T00:00:00.000Z");
const TOKEN = "a".repeat(48);

function message(overrides: Partial<Parameters<typeof buildInvitationMessage>[0]> = {}) {
  return buildInvitationMessage({
    to: "teammate@example.com",
    orgName: "Northwind",
    role: "recruiter",
    token: TOKEN,
    expiresAt: SEVEN_DAYS_OUT,
    now: NOW,
    ...overrides,
  });
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

describe("buildInvitationLink", () => {
  it("puts the token in a query parameter on the single redemption path", () => {
    const link = buildInvitationLink(TOKEN);
    expect(link).toBe(`${INVITATION_REDEEM_PATH}?token=${TOKEN}`);
  });

  it("escapes a token so it cannot escape its parameter", () => {
    // Mail clients rewrite long query strings. A token that broke out of the
    // parameter would silently redeem the wrong thing, or nothing.
    const link = buildInvitationLink("ab&cd=ef#g");
    expect(link).toContain("token=ab%26cd%3Def%23g");
    expect(link).not.toContain("token=ab&cd");
  });
});

describe("buildInvitationMessage", () => {
  it("names the team and the role the invitee is being given", () => {
    const m = message();
    expect(m.subject).toContain("Northwind");
    expect(m.body).toContain("Northwind");
    expect(m.body).toContain("recruiter");
  });

  it("describes each invitable role in the recipient's terms", () => {
    // The recipient is being told what they get, not what our enum is called.
    expect(message({ role: "admin" }).body).toContain("team admin");
    expect(message({ role: "recruiter" }).body).toContain("recruiter");
    expect(message({ role: "viewer" }).body).toContain("viewer");
  });

  it("states the redemption deadline as a date and a single duration", () => {
    // Two conflicting durations ("in 1 day (7 days from now)") are how a
    // recipient ends up thinking they have a week when they have a day.
    const m = message();
    expect(m.body).toContain("2026-10-08");
    expect(m.body).toContain("7 days from now");
    expect(m.body).not.toContain("7 days from when it was sent");

    const one = message({ expiresAt: new Date("2026-10-02T00:00:00.000Z") });
    expect(one.body).toContain("1 day from now");
    expect(one.body).not.toContain("1 days");
  });

  it("includes the token in the body as well as the button", () => {
    // A recipient whose mail client mangles the link can still join.
    const m = message();
    expect(m.body).toContain(TOKEN);
    expect(m.ctaHref).toContain(TOKEN);
  });

  it("labels the call to action and points it at the redemption path", () => {
    const m = message();
    expect(m.ctaLabel).toBe("Join the team");
    expect(m.ctaHref).toBe(buildInvitationLink(TOKEN));
  });

  it("falls back to generic wording when the org name is unavailable", () => {
    // A missing name costs the recipient context; it must not produce an
    // invitation that reads as broken.
    expect(message({ orgName: "   " }).body).toContain("an Odesseus employer team");
  });

  it("does not read as an account already created", () => {
    // AGENTS.md: nothing is added to the team until the invitation is accepted.
    expect(message().body).toContain("until you accept");
  });
});

describe("sendInvitationEmail", () => {
  it("reports an unconfigured transport without throwing", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.ODESSEUS_PARTNER_FROM_EMAIL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendInvitationEmail({
      to: "teammate@example.com",
      orgName: "Northwind",
      role: "viewer",
      token: TOKEN,
      expiresAt: SEVEN_DAYS_OUT,
      now: NOW,
    });

    // A deployment state, not a failure: the route still returns the token so
    // the admin can pass the link on.
    expect(result).toEqual({ sent: false, reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the invitation to the invitee with the redemption link", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.ODESSEUS_PARTNER_FROM_EMAIL = "Odesseus <hello@example.com>";
    process.env.NEXT_PUBLIC_SITE_URL = "https://odesseus.ai";

    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendInvitationEmail({
      to: "teammate@example.com",
      orgName: "Northwind",
      role: "recruiter",
      token: TOKEN,
      expiresAt: SEVEN_DAYS_OUT,
      now: NOW,
    });

    expect(result).toEqual({ sent: true });
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((request.headers as Record<string, string>).authorization).toBe(
      "Bearer re_test_key"
    );

    const payload = JSON.parse(String(request.body));
    expect(payload.to).toEqual(["teammate@example.com"]);
    expect(payload.subject).toContain("Northwind");
    // The link is absolutised against the site url by the shared transport.
    expect(payload.html).toContain(
      `https://odesseus.ai${INVITATION_REDEEM_PATH}?token=${TOKEN}`
    );
  });

  it("reports a provider error instead of throwing", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.ODESSEUS_PARTNER_FROM_EMAIL = "Odesseus <hello@example.com>";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 422 }))
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendInvitationEmail({
      to: "teammate@example.com",
      orgName: "Northwind",
      role: "recruiter",
      token: TOKEN,
      expiresAt: SEVEN_DAYS_OUT,
      now: NOW,
    });

    expect(result).toEqual({ sent: false, reason: "provider_error" });
    consoleError.mockRestore();
  });

  it("reports a network error instead of throwing", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.ODESSEUS_PARTNER_FROM_EMAIL = "Odesseus <hello@example.com>";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection reset")));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendInvitationEmail({
      to: "teammate@example.com",
      orgName: "Northwind",
      role: "recruiter",
      token: TOKEN,
      expiresAt: SEVEN_DAYS_OUT,
      now: NOW,
    });

    expect(result).toEqual({ sent: false, reason: "network_error" });
    consoleError.mockRestore();
  });

  it("never writes the redemption token to the log on a failure", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.ODESSEUS_PARTNER_FROM_EMAIL = "Odesseus <hello@example.com>";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection reset")));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await sendInvitationEmail({
      to: "teammate@example.com",
      orgName: "Northwind",
      role: "recruiter",
      token: TOKEN,
      expiresAt: SEVEN_DAYS_OUT,
      now: NOW,
    });

    // The token is a redemption secret. It belongs in the email and the
    // response, never in a log line someone might paste into a ticket.
    for (const call of consoleError.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(TOKEN);
    }
    consoleError.mockRestore();
  });
});
