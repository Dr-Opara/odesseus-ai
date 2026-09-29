import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { employerFitScoreSchema } from "./schemas";

const MODEL = process.env.ODESSEUS_MATCH_MODEL || "gpt-5.6-luna";

export const EMPLOYER_FIT_MODEL_VERSION = "v1";

const SYSTEM_PROMPT = `
You score one job application against one employer posting for the hiring team.

Evidence rules (load-bearing):
- Use ONLY the supplied job posting and the submitted resume. Nothing else.
- Every requiredMatches/preferredMatches entry must cite resume evidence when
  matched is true. An empty evidence array with matched true is a failure.
- Missing qualifications and missing skills name gaps honestly. Never invent
  experience, tools, dates, certifications, achievements, metrics, employers,
  education, or outcomes to fill a gap.
- Location alignment uses only stated locations and the stated work
  arrangement. Never infer relocation willingness or commute feasibility.
- Blockers are explicit deal-breakers stated in the posting and verifiably
  unmet in the resume (for example a required license the resume does not
  show). When none exist, return an empty array.
- Work authorization may only be considered when explicitly supplied in the
  resume or the posting, and only as a stated requirement gap.

Prohibited inputs:
- Never consider, infer, or mention race, ethnicity, religion, sex, gender,
  sexual orientation, disability, veteran status, age, political affiliation,
  or any other protected characteristic. The inputs do not contain them and
  the output must not contain them.
- Do not use name, photo, address, or any demographic proxy as signal.

Scoring:
- overallScore 0-100 reflects evidence-backed fit against required first,
  preferred second. State the reasoning in explanation.
- Keep output concise and factual. No hiring recommendation, no prediction
  about the candidate.
`;

export async function generateEmployerFitScore(input: {
  jobTitle: string;
  jobDescription: string | null;
  requirementsText: string | null;
  preferredText: string | null;
  location: string | null;
  workArrangement: string | null;
  resumeSnapshot: unknown;
}) {
  const result = await generateText({
    model: openai(MODEL),
    output: Output.object({
      name: "OdesseusEmployerFitScore",
      description: "Evidence-backed fit of one application against one posting.",
      schema: employerFitScoreSchema,
    }),
    system: SYSTEM_PROMPT,
    prompt: `
JOB TITLE: ${input.jobTitle}
LOCATION: ${input.location || "Not stated"}
WORK ARRANGEMENT: ${input.workArrangement || "Not stated"}

JOB DESCRIPTION:
${input.jobDescription || "Not provided"}

REQUIRED QUALIFICATIONS:
${input.requirementsText || "Not provided separately; derive only from the description above."}

PREFERRED QUALIFICATIONS:
${input.preferredText || "Not provided separately; derive only from the description above."}

SUBMITTED RESUME:
${JSON.stringify(input.resumeSnapshot)}
`,
    providerOptions: {
      openai: { store: false },
    },
  });

  return result.output;
}
