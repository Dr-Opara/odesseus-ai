/**
 * Careers email.
 *
 * A thin wrapper over the shared transport (`@/lib/email/send`), exactly as the
 * partner and employer-invitation senders are. The careers work that came in
 * from the pricing branch carried its own `fetch` against the Resend API; that
 * was a second copy of the same integration with none of the retry queue, so it
 * is not carried over. There is still exactly one Resend integration in this
 * codebase and it is the one every other sender uses.
 *
 * Nothing here logs the applicant's name, address, or answers. A careers
 * message is about a person's job search, and a support ticket should not end
 * up carrying any of it.
 */

import { sendEmail, type EmailResult } from "@/lib/email/send";

/**
 * The exact fields handed to the transport. Named and exported so a test can
 * assert on the wording without a provider.
 */
export type CareerMessage = {
  subject: string;
  heading: string;
  body: string;
};

/**
 * The receipt an applicant gets once their application is stored.
 *
 * It says the two things that are true and the one thing a candidate is
 * entitled to be told: the application is in the queue, and buying Odesseus
 * Live is irrelevant to it. It promises no timeline, because hiring has one and
 * we do not control it.
 */
export function buildApplicationReceipt(input: {
  fullName: string;
  roleTitle: string;
}): CareerMessage {
  return {
    subject: `We received your application — ${input.roleTitle}`,
    heading: "Your application is with us.",
    body: [
      `Thank you for applying to Odesseus for ${input.roleTitle}.`,
      "",
      "Your application is in our hiring queue. We read every one independently.",
      "",
      "Using Odesseus Live has no effect on your application. We assess people, not subscriptions.",
      "",
      "We will be in touch if your experience is a fit for what we are building.",
    ].join("\n"),
  };
}

/**
 * The notice an applicant gets when a reviewer moves their application.
 *
 * This is the one email in a hiring pipeline that cannot be skipped. A
 * candidate who is rejected and told nothing is the failure mode everybody
 * knows: they keep waiting, keep preparing, and learn the outcome from a
 * silence. `rejected` therefore sends a real message.
 *
 * The wording stays inside what the product can honestly claim. It says the
 * decision, it does not score the interview, does not predict a future, and
 * does not mention what the applicant paid for — an application submitted
 * anonymously has no Odesseus account attached, so the question does not arise.
 */
export function buildStatusNotice(input: {
  firstName: string;
  roleTitle: string;
  status: "interview" | "rejected" | "hired";
}): CareerMessage {
  const greeting = `Hi ${input.firstName.split(/\s+/)[0]},`;

  if (input.status === "hired") {
    return {
      subject: `Your application for ${input.roleTitle}`,
      heading: "We would like to hire you.",
      body: [
        greeting,
        "",
        `We would like to offer you the ${input.roleTitle} role at Odesseus.`,
        "",
        "A human will follow up with the details.",
      ].join("\n"),
    };
  }

  if (input.status === "interview") {
    return {
      subject: `Next step for ${input.roleTitle}`,
      heading: "We would like to talk to you.",
      body: [
        greeting,
        "",
        `We have read your application for ${input.roleTitle} and would like to speak with you.`,
        "",
        "A human will be in touch to arrange a time.",
      ].join("\n"),
    };
  }

  return {
    subject: `Your application for ${input.roleTitle}`,
    heading: "We have decided not to move forward.",
    body: [
      greeting,
      "",
      `Thank you for applying for ${input.roleTitle}. We have decided not to move forward with your application.`,
      "",
      "This was a decision about this role, not about you. We read every application ourselves, and the bar for a founding team is a specific kind of experience rather than a ranking of people.",
    ].join("\n"),
  };
}


/**
 * Delivers a careers message.
 *
 * Never throws. The application row is already written by the time either of
 * these is called, and reporting a send failure as a submission failure would
 * tell an applicant their application was rejected when it was recorded
 * perfectly well.
 */
export async function sendCareerMessage(
  input: { to: string } & CareerMessage
): Promise<EmailResult> {
  return sendEmail(input, "[ODESSEUS_CAREERS]");
}
