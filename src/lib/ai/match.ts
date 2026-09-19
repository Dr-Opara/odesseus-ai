import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { matchAssessmentSchema, type ResumeProfile } from "./schemas";
import { calculateMatchScore } from "./scoring";

const MODEL = process.env.ODYSSEUS_MATCH_MODEL || "gpt-5.6-luna";

type Preferences = {
  min_match_score: number;
  target_titles: string[];
  target_locations: string[];
  industries: string[];
  remote_only: boolean;
  minimum_salary: number | null;
  work_authorization: string | null;
  sponsorship_needed: boolean | null;
};

export async function assessJobMatch(input: {
  resume: ResumeProfile;
  profile: Record<string, unknown>;
  preferences: Preferences | null;
  companyName?: string;
  roleTitle?: string;
  jobDescription: string;
}) {
  const result = await generateText({
    model: openai(MODEL),
    output: Output.object({
      name: "OdysseusMatchAssessment",
      description: "Evidence-grounded comparison of a verified candidate profile against a job description.",
      schema: matchAssessmentSchema,
    }),
    system: `
You are Odysseus's job-match evaluator.

Compare a job description only against the verified candidate information provided.

Critical rules:
- Never infer that the candidate has a skill, certification, clearance, degree, authorization, responsibility, or accomplishment that is not present in the candidate data.
- Do not reward keyword similarity when the candidate lacks the underlying requirement.
- Separate required qualifications from preferred qualifications.
- Mark a hard requirement critical only when the job description clearly treats it as mandatory or disqualifying.
- If evidence is unclear, use "unknown" rather than "met".
- Scores are evidence assessments from 0 to 100, not probabilities.
- Be concise. Evidence should point to actual candidate facts.
- Candidate preferences affect only candidatePreferences and locationAndWorkArrangement.
- Do not inflate the overall fit to make the candidate feel good.
`,
    prompt: `
CANDIDATE RESUME PROFILE:
${JSON.stringify(input.resume)}

CANDIDATE ACCOUNT PROFILE:
${JSON.stringify(input.profile)}

CANDIDATE JOB PREFERENCES:
${JSON.stringify(input.preferences)}

USER-PROVIDED COMPANY:
${input.companyName || "Not supplied"}

USER-PROVIDED ROLE:
${input.roleTitle || "Not supplied"}

JOB DESCRIPTION:
${input.jobDescription}

Return an evidence-grounded assessment.
`,
    providerOptions: {
      openai: { store: false },
    },
  });

  const scoring = calculateMatchScore(result.output);

  return {
    assessment: result.output,
    score: scoring.score,
    criticalMissing: scoring.criticalMissing,
    weights: scoring.weights,
  };
}
