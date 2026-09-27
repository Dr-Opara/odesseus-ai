import { describe, expect, it, vi, beforeEach } from "vitest";

const sendEmailMock = vi.fn();

vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

import { buildApplicationReceipt, buildStatusNotice, sendCareerMessage } from "@/lib/careers/email";

describe("buildApplicationReceipt", () => {
  const receipt = buildApplicationReceipt({
    fullName: "Ada Lovelace",
    roleTitle: "Founding Product Engineer",
  });

  it("names the role it applies to", () => {
    expect(receipt.subject).toContain("Founding Product Engineer");
  });

  it("states only what is true", () => {
    expect(receipt.body).toContain("Founding Product Engineer");
    expect(receipt.body).toContain("hiring queue");
  });

  it("promises no timeline and no decision", () => {
    // A receipt that says "we will get back to you within a week" creates an
    // expectation nobody here can meet, and a hiring queue is exactly the place
    // that promise goes unmet.
    expect(receipt.body).not.toMatch(/within \d+ (business )?(day|week|month)/i);
    expect(receipt.body).not.toMatch(/we(?:'ll| will) (?:get back|respond|reply) (?:to you )?(?:soon|shortly)/i);
  });

  it("states plainly that the product purchase is irrelevant", () => {
    // The rule is a hiring pipeline: paying for Odesseus Live buys nothing here,
    // and the message is the place a candidate would otherwise assume otherwise.
    expect(receipt.body).toMatch(/no effect on your application/i);
  });
});

describe("buildStatusNotice", () => {
  it("greets by first name only", () => {
    // The full name is already in the record; the greeting does not need to
    // repeat it, and "Hi Ada" is how a person writes to another person.
    expect(buildStatusNotice({ firstName: "Ada Lovelace", roleTitle: "Engineer", status: "rejected" }).body)
      .toContain("Hi Ada,");
  });

  it("says the rejection is about the role, not the person", () => {
    const notice = buildStatusNotice({
      firstName: "Ada",
      roleTitle: "Engineer",
      status: "rejected",
    });
    expect(notice.body).toMatch(/not to move forward/i);
    expect(notice.body).toMatch(/not about you/i);
  });

  it("never scores, ranks, or predicts", () => {
    // The post-interview rules in AGENTS.md are about the candidate's job search
    // with an employer, but the same honesty applies here: a rejection notice
    // that grades the applicant is both cruel and untrue.
    for (const status of ["interview", "rejected", "hired"] as const) {
      const notice = buildStatusNotice({ firstName: "Ada", roleTitle: "Engineer", status });
      expect(notice.body).not.toMatch(/\b(score|scored|rating|ranked|percentile)\b/i);
      expect(notice.body).not.toMatch(/\byou (?:scored|ranked|were ranked)\b/i);
    }
  });

  it("offers the interview and the hire without inventing a detail", () => {
    const interview = buildStatusNotice({ firstName: "Ada", roleTitle: "Engineer", status: "interview" });
    expect(interview.heading).toMatch(/talk to you/i);
    expect(interview.body).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no invented date
    expect(interview.body).not.toMatch(/\$\d/); // no invented compensation

    const hired = buildStatusNotice({ firstName: "Ada", roleTitle: "Engineer", status: "hired" });
    expect(hired.heading).toMatch(/hire you/i);
    expect(hired.body).toMatch(/follow up with the details/i);
  });

  it("does not mention any product purchase", () => {
    // An application submitted anonymously has no Odesseus account attached, so
    // the question cannot arise and naming the product would only confuse.
    for (const status of ["interview", "rejected", "hired"] as const) {
      const notice = buildStatusNotice({ firstName: "Ada", roleTitle: "Engineer", status });
      expect(notice.body).not.toMatch(/odesseus live/i);
      expect(notice.subject).not.toMatch(/wallet|credit|pass/i);
    }
  });

  it("survives a single-word name", () => {
    expect(() =>
      buildStatusNotice({ firstName: "Prince", roleTitle: "Engineer", status: "hired" })
    ).not.toThrow();
  });
});

describe("sendCareerMessage", () => {
  beforeEach(() => sendEmailMock.mockReset());

  it("goes through the shared transport, not a second Resend integration", async () => {
    sendEmailMock.mockResolvedValue({ sent: true });
    const result = await sendCareerMessage({
      to: "ada@example.com",
      subject: "s",
      heading: "h",
      body: "b",
    });

    expect(result).toEqual({ sent: true });
    // The whole point of a thin wrapper: the careers sender has no fetch, no key
    // handling, and no retry queue of its own.
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][1]).toBe("[ODESSEUS_CAREERS]");
  });

  it("reports an unconfigured transport distinctly from a provider failure", async () => {
    // A deployment without RESEND_API_KEY is a state to report, not an outage to
    // retry -- and the row is already written either way.
    sendEmailMock.mockResolvedValue({ sent: false, reason: "not_configured" });
    expect(await sendCareerMessage({ to: "a@b.co", subject: "s", heading: "h", body: "b" })).toEqual({
      sent: false,
      reason: "not_configured",
    });
  });
});
