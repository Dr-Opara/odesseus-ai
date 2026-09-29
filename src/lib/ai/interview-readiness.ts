import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { interviewReadinessSchema } from "./schemas";

const MODEL = process.env.ODESSEUS_MATCH_MODEL || "gpt-5.6-luna";

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
      name: "OdesseusInterviewReadiness",
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

Additionally, generate the following prep modules, grounded entirely in the provided context. If any module cannot be meaningfully populated from the available evidence, include it as an empty array or null.

PREP MODULES (include all):
- likelyQuestions: 5-8 likely question topics/areas the interviewer may explore, based on the job requirements and candidate's background.
- behavioralQuestions: 4-6 structured behavioral questions (e.g. "Tell me about a time you..."), each with a brief focus area.
- starPrompts: 3-5 STAR-format prompts (Situation-Task-Action-Result) with example labels and source evidence keywords.
- technicalConceptQuestions: 3-4 technical concept questions relevant to the role, each with a brief "why this matters" explanation.
- companySpecific: 3-4 company/job-specific preparation areas (e.g. recent product launches, mission alignment, key challenges).
- questionsToAskInterviewer: 4-5 thoughtful questions the candidate may ask the interviewer, focused on role, team, or company.
- prepSummary: A concise 2-sentence summary of the candidate's readiness state, highlighting strengths and one development area.
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

Generate interview readiness guidance with all prep modules as described above.
`,
    providerOptions: {
      openai: { store: false },
    },
  });

  return result.output;
}
