import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { roundHandoffSchema } from "./schemas";

const MODEL = process.env.ODYSSEUS_MATCH_MODEL || "gpt-5.6-luna";

export const ROUND_HANDOFF_SYSTEM_PROMPT = `
You maintain memory across rounds of a real job interview.

Rules:
- Use only the user's notes and frozen application context.
- Do not predict whether the candidate will get the job.
- Do not grade performance or infer interviewer intent.
- "Interviewer signals" are user-recorded observations, not facts about intent.
- Do not invent questions, commitments, topics, or experiences.
- The purpose is continuity: remember what was already discussed, avoid needless repetition, and carry forward open threads.
- Keep the handoff concise.
`;

export async function generateRoundHandoff(input: {
  companyName: string;
  roleTitle: string;
  jobSnapshot: unknown;
  questionsAsked: string[];
  topicsDiscussed: string[];
  experiencesUsed: string[];
  interviewerSignals: string[];
  commitments: string[];
  candidateNotes: string | null;
}) {
  const result = await generateText({
    model: openai(MODEL),
    output: Output.object({
      name: "OdysseusRoundHandoff",
      description:
        "A concise, factual handoff from one interview round to the next.",
      schema: roundHandoffSchema,
    }),
    system: ROUND_HANDOFF_SYSTEM_PROMPT,
    prompt: `
COMPANY: ${input.companyName}
ROLE: ${input.roleTitle}

FROZEN JOB CONTEXT:
${JSON.stringify(input.jobSnapshot)}

QUESTIONS ASKED:
${JSON.stringify(input.questionsAsked)}

TOPICS DISCUSSED:
${JSON.stringify(input.topicsDiscussed)}

EXPERIENCES USED:
${JSON.stringify(input.experiencesUsed)}

USER-RECORDED INTERVIEWER SIGNALS:
${JSON.stringify(input.interviewerSignals)}

COMMITMENTS / FOLLOW-UPS:
${JSON.stringify(input.commitments)}

CANDIDATE NOTES:
${input.candidateNotes || ""}

Create a round-to-round handoff.
`,
    providerOptions: {
      openai: { store: false },
    },
  });

  return result.output;
}
