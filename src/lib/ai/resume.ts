import mammoth from "mammoth";
import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { resumeProfileSchema, type ResumeProfile } from "./schemas";

const MODEL = process.env.ODYSSEUS_MATCH_MODEL || "gpt-5.6-luna";

const instructions = `
You extract a candidate's professional history from a resume for a job-matching product.

Rules:
- Treat the resume as the source of truth.
- Never invent employers, dates, skills, certifications, education, achievements, clearance, or responsibilities.
- verifiedFacts must contain only facts explicitly supported by the resume.
- Normalize obvious skill names, but do not add adjacent skills merely because they are common.
- If something is uncertain or absent, omit it or use null.
- Keep responsibilities and achievements concise and faithful to the document.
`;

export async function parseResume(input: {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}): Promise<ResumeProfile> {
  if (input.mimeType === "application/pdf") {
    const result = await generateText({
      model: openai(MODEL),
      output: Output.object({
        name: "CandidateResumeProfile",
        description: "Verified professional facts extracted from a resume.",
        schema: resumeProfileSchema,
      }),
      system: instructions,
      prompt: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract the candidate profile from this resume.",
            },
            {
              type: "file",
              mediaType: "application/pdf",
              data: input.bytes,
              filename: input.fileName,
            },
          ],
        },
      ],
      providerOptions: {
        openai: { store: false },
      },
    });

    return result.output;
  }

  const extracted = await mammoth.extractRawText({
    buffer: Buffer.from(input.bytes),
  });

  const result = await generateText({
    model: openai(MODEL),
    output: Output.object({
      name: "CandidateResumeProfile",
      description: "Verified professional facts extracted from a resume.",
      schema: resumeProfileSchema,
    }),
    system: instructions,
    prompt: `Extract the candidate profile from the following DOCX resume text.

RESUME:
${extracted.value}`,
    providerOptions: {
      openai: { store: false },
    },
  });

  return result.output;
}
