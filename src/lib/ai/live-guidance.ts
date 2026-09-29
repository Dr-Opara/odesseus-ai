import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { liveGuidanceSchema, type LiveGuidance } from "./schemas";

const MODEL = process.env.ODESSEUS_LIVE_GUIDANCE_MODEL || process.env.ODESSEUS_MATCH_MODEL || "gpt-5.6-luna";

export const LIVE_CODING_UNSUPPORTED_MESSAGE =
  "Odesseus Live does not assist with coding interviews. Answer from your own preparation.";

const CODING_INTENT_PATTERNS: RegExp[] = [
  /\b(write|implement|code|coding|program|debug|refactor|compile|execute)\b[^.]{0,60}\b(code|function|method|class|script|program|algorithm|solution)\b/i,
  /\b(leetcode|hackerrank|codeforces|take-home|take home|whiteboard coding|live coding|pair programming)\b/i,
  /\b(big-?o|time complexity|space complexity|binary search|dynamic programming|recursion|linked list|binary tree|graph traversal)\b/i,
  /\b(solve|solution)\b[^.]{0,40}\b(algorithm|algorithmic|coding|leetcode)\b/i,
  /```[\s\S]*```/,
];

/** True when the transcript asks for live coding help, which Live never provides. */
export function isCodingInterviewRequest(transcript: string): boolean {
  if (!transcript || transcript.trim().length === 0) return false;
  return CODING_INTENT_PATTERNS.some((pattern) => pattern.test(transcript));
}

function codingUnsupportedResponse(transcript: string): LiveGuidance {
  return {
    isQuestion: true,
    questionText: transcript,
    responseText: null,
    structure: null,
    verifiedEvidence: [],
    caution: LIVE_CODING_UNSUPPORTED_MESSAGE,
  };
}

export const LIVE_GUIDANCE_SYSTEM_PROMPT = `
You are a real-time interview support assistant for the candidate.

The candidate remains the speaker. You provide concise on-screen guidance only.

Rules:
- Use ONLY verified facts from the supplied context.
- Never invent experience, tools, dates, certifications, achievements, metrics, employers, education, or outcomes.
- If the transcript is not an interviewer question or a clear request for the candidate to respond, set isQuestion=false.
- If the question asks about something not supported by verified context, say so in caution and suggest an honest bridging answer.
- Odesseus Live never assists with coding interviews: no code writing, debugging, algorithm solving, or IDE help. A coding request is answered only with the unsupported notice.
- Do not pretend the candidate did something they did not do.
- Keep guidance natural enough to speak aloud, not essay-like.
- Respect the configured response style and length in context.
- mode=star: organize around Situation, Task, Action, Result only where verified evidence supports it.
- mode=shorter: shorten the answer substantially.
- mode=technical: emphasize technical detail that is actually supported.
- mode=follow_up: answer as a follow-up to the same question.
- Return verifiedEvidence as short reminders of the exact facts used.
`;

export async function generateLiveGuidance(input: {
  transcript: string;
  mode: "default" | "star" | "shorter" | "technical" | "follow_up" | "manual";
  context: unknown;
}) {
  // Coding interview assistance is out of scope. Refuse before any model
  // call so no code, algorithm, or debugging help can be produced.
  if (isCodingInterviewRequest(input.transcript)) {
    return codingUnsupportedResponse(input.transcript);
  }

  const result = await generateText({
    model: openai(MODEL),
    output: Output.object({
      name: "OdesseusLiveGuidance",
      description: "Grounded, concise interview answer guidance.",
      schema: liveGuidanceSchema,
    }),
    system: LIVE_GUIDANCE_SYSTEM_PROMPT,
    prompt: `
LIVE TRANSCRIPT:
${input.transcript}

REQUESTED MODE:
${input.mode}

VERIFIED INTERVIEW CONTEXT:
${JSON.stringify(input.context)}
`,
    providerOptions: {
      openai: { store: false },
    },
  });

  return result.output;
}
