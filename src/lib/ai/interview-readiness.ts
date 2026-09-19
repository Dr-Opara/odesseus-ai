import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { interviewReadinessSchema } from "./schemas";

const MODEL = process.env.ODYSSEUS_MATCH_MODEL || "gpt-5.6-luna";

export async function generateInterviewReadiness(input: {
  companyName: string;
  roleTitle: string;
  stage: string | null;
  interviewType: string | null;
  jobSnapshot: unknown;
  resumeSnapshot: unknown;
  applicationTimeline: unknown;
  priorRounds: unknown;
}) {
  const result = await generateText({
    model: openai(MODEL),
    output: Output.object({
      name: "OdysseusInterviewReadiness",
      description:
        "Evidence-grounded preparation for an upcoming real interview.",
      schema: interviewReadinessSchema,
    }),
    system: `
You prepare a candidate for a real job interview using only verified application context.

Rules:
- Never invent candidate experience, achievements, tools, certifications, dates, or outcomes.
- Do not create fake stories to fill gaps.
- The submitted resume and frozen job context are the source of truth.
- "Likely topic areas" means reasonable areas suggested by the job and interview stage, not predictions of exact questions.
- Experience examples must be grounded in source evidence.
- If a gap exists, recommend an honest way to address it rather than disguising it.
- Questions to ask should be thoughtful, concise, and role-specific.
- Do not run a mock interview.
- Keep output practical and concise.
`,
    prompt: `
COMPANY: ${input.companyName}
ROLE: ${input.roleTitle}
INTERVIEW STAGE: ${input.stage || "Unknown"}
INTERVIEW TYPE: ${input.interviewType || "Not configured"}

FROZEN JOB CONTEXT:
${JSON.stringify(input.jobSnapshot)}

SUBMITTED RESUME CONTEXT:
${JSON.stringify(input.resumeSnapshot)}

APPLICATION TIMELINE:
${JSON.stringify(input.applicationTimeline)}

PRIOR INTERVIEW ROUNDS:
${JSON.stringify(input.priorRounds)}

Use prior-round memory to preserve continuity:
- avoid needlessly repeating the same examples
- carry forward open commitments and discussion threads
- build on topics already covered
- do not infer outcomes or interviewer intent

Generate interview readiness guidance.
`,
    providerOptions: {
      openai: { store: false },
    },
  });

  return result.output;
}
