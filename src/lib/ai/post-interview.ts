import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { postInterviewAnalysisSchema } from "./schemas";

const MODEL =
  process.env.ODYSSEUS_POST_INTERVIEW_MODEL ||
  process.env.ODYSSEUS_MATCH_MODEL ||
  "gpt-5.6-luna";

export const POST_INTERVIEW_ANALYSIS_SYSTEM_PROMPT = `
You analyze a completed real job interview for the candidate.

Critical rules:
- Do not predict whether the candidate will receive an offer or advance.
- Do not grade, score, rank, or label overall interview performance.
- Do not infer interviewer intent, emotion, hidden sentiment, or hiring probability.
- The realtime transcript may contain mixed interviewer/candidate audio and may not identify speakers perfectly.
- State material transcript limitations explicitly.
- Questions marked by the system as is_question=true are the strongest evidence of questions asked.
- Extract only topics, experiences, and commitments that are clearly supported.
- "Answers to strengthen" means areas where the transcript/guidance shows a clearer future answer could be useful; do not call an answer bad or weak.
- "Possible next-round topics" must be framed as plausible topics suggested by the discussion/job, never predictions.
- Do not invent candidate experience or interviewer comments.
- The follow-up email must be concise, professional, factual, and based on actual interview context.
- Do not include claims such as "I enjoyed our discussion about X" unless X is supported by the transcript.
- Do not include salary, legal, demographic, or sensitive information unless explicitly necessary and supported.
`;

export async function generatePostInterviewAnalysis(input: {
  companyName: string;
  roleTitle: string;
  stage: string | null;
  jobSnapshot: unknown;
  resumeSnapshot: unknown;
  transcriptItems: Array<{
    transcript: string;
    is_question: boolean;
    question_text: string | null;
    occurred_at: string;
  }>;
  guidanceItems: Array<{
    question_text: string;
    response_text: string;
    verified_evidence: string[];
    caution: string | null;
    created_at: string;
  }>;
  priorRoundMemory: unknown;
  interviewerDetails: unknown;
}) {
  const result = await generateText({
    model: openai(MODEL),
    output: Output.object({
      name: "OdysseusPostInterviewAnalysis",
      description:
        "A factual, non-predictive analysis of a completed job interview.",
      schema: postInterviewAnalysisSchema,
    }),
    system: POST_INTERVIEW_ANALYSIS_SYSTEM_PROMPT,
    prompt: `
COMPANY: ${input.companyName}
ROLE: ${input.roleTitle}
INTERVIEW STAGE: ${input.stage || "Unknown"}

FROZEN JOB CONTEXT:
${JSON.stringify(input.jobSnapshot)}

FROZEN SUBMITTED RESUME:
${JSON.stringify(input.resumeSnapshot)}

INTERVIEWER DETAILS:
${JSON.stringify(input.interviewerDetails)}

TRANSCRIPT ITEMS:
${JSON.stringify(input.transcriptItems)}

LIVE GUIDANCE GENERATED DURING INTERVIEW:
${JSON.stringify(input.guidanceItems)}

PRIOR ROUND MEMORY:
${JSON.stringify(input.priorRoundMemory)}

Create a factual post-interview analysis and follow-up draft.
`,
    providerOptions: {
      openai: { store: false },
    },
  });

  return result.output;
}
