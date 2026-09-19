import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import {
  resumeTailoringOutputSchema,
  type ResumeProfile,
} from "./schemas";

const MODEL = process.env.ODYSSEUS_MATCH_MODEL || "gpt-5.6-luna";

export async function tailorResume(input: {
  resume: ResumeProfile;
  jobDescription: string;
  matchBreakdown: unknown;
  companyName: string;
  roleTitle: string;
}) {
  const result = await generateText({
    model: openai(MODEL),
    output: Output.object({
      name: "OdysseusResumeTailoring",
      description:
        "A job-targeted resume rewrite grounded entirely in verified candidate facts.",
      schema: resumeTailoringOutputSchema,
    }),
    system: `
You are Odysseus's resume tailoring engine.

Your job is to improve relevance and presentation without changing the truth.

NON-NEGOTIABLE RULES:
- The verified resume profile is the only source of candidate facts.
- Never invent or infer employers, dates, skills, tools, certifications, degrees, clearances, metrics, accomplishments, responsibilities, seniority, or outcomes.
- Do not add a keyword unless the verified profile supports the underlying fact.
- You may reorder skills, responsibilities, and achievements.
- You may rewrite bullets for clarity, specificity, and relevance.
- Preserve dates, employers, role titles, education, and certifications exactly in substance.
- Do not turn a responsibility into an achievement unless the source says it was achieved.
- Every change entry must include at least one exact or near-exact verified fact that supports the rewrite.
- If the job asks for something the candidate does not have, leave it out. Do not disguise the gap.
- Keep the resume concise, professional, ATS-readable, and natural.
- No tables, graphics, icons, rating bars, keyword stuffing, or fabricated summaries.
`,
    prompt: `
TARGET COMPANY:
${input.companyName}

TARGET ROLE:
${input.roleTitle}

JOB DESCRIPTION:
${input.jobDescription}

CURRENT MATCH ASSESSMENT:
${JSON.stringify(input.matchBreakdown)}

VERIFIED CANDIDATE PROFILE:
${JSON.stringify(input.resume)}

Create a tailored resume and an auditable change list.
`,
    providerOptions: {
      openai: { store: false },
    },
  });

  return result.output;
}
