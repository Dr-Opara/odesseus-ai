import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const MODEL = process.env.ODYSSEUS_MATCH_MODEL || "gpt-5.6-luna";

const emailSignalSchema = z.object({
  signalType: z.enum([
    "employer_response",
    "assessment",
    "interview_invite",
    "interview_update",
    "rejection",
    "offer",
    "unknown",
  ]),
  confidence: z.number().min(0).max(1),
  stage: z.string().nullable(),
  scheduledAt: z.string().nullable(),
  timezone: z.string().nullable(),
  meetingProvider: z.string().nullable(),
  meetingUrl: z.string().nullable(),
  interviewerName: z.string().nullable(),
  interviewerEmail: z.string().nullable(),
  conciseSummary: z.string(),
});

export async function extractEmailSignal(input: {
  subject: string;
  sender: string;
  body: string;
  application: { company_name: string; role_title: string };
}) {
  const result = await generateText({
    model: openai(MODEL),
    output: Output.object({
      name: "OdysseusEmployerSignal",
      description: "A conservative extraction of an employer recruiting email.",
      schema: emailSignalSchema,
    }),
    system: `
You extract recruiting/application signals from an email for a career tracking product.

Rules:
- Never invent dates, times, people, meeting links, interview stages, or outcomes.
- The email must be interpreted in the context of the supplied company and role.
- scheduledAt must be an ISO 8601 timestamp only when the email clearly provides enough information to determine it. Otherwise null.
- If the email is ambiguous, use signalType "unknown".
- Rejection and offer classifications require explicit language.
- An ordinary recruiter reply is employer_response, not interview_invite, unless an interview or screening meeting is actually being proposed or confirmed.
- Keep conciseSummary factual and short.
`,
    prompt: `
APPLICATION:
Company: ${input.application.company_name}
Role: ${input.application.role_title}

EMAIL:
From: ${input.sender}
Subject: ${input.subject}

${input.body.slice(0, 12000)}
`,
    providerOptions: {
      openai: { store: false },
    },
  });

  return result.output;
}
