import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// F13-J: candidate-private Odesseus Live/Interview Prep data must never reach
// an employer view. Two layers:
//
//  1. The employer domain modules must not import from the candidate-private
//     Live or interview domains. The adapters are now wired to the real
//     hiring backend, so this is the check that stops a future edit from
//     pulling candidate-private data into an employer read.
//  2. The employer display types must not grow a field that would carry it.
//     `CandidateDetail` in src/lib/employers/types.ts has no transcript,
//     guidance, mock-interview, or post-interview-analysis member, and this
//     asserts that stays true.
//
// It used to also assert a candidate fixture had no such keys. There is no
// employer fixture data any more, so there is nothing left to make that
// assertion about.

const EMPLOYER_DOMAIN_FILES = [
  "src/lib/employers/types.ts",
  "src/lib/employers/candidates-adapter.ts",
  "src/lib/employers/pipeline-adapter.ts",
  "src/lib/employers/stages.ts",
  "src/lib/employers/job-description.ts",
  "src/components/employers/fit-score-panel.tsx",
  "src/components/employers/candidate-stage-actions.tsx",
  "src/app/employers/candidates/page.tsx",
  "src/app/employers/candidates/[id]/page.tsx",
  "src/app/employers/pipeline/page.tsx",
];

// Matches real `from "@/lib/live"` / `from '@/lib/interviews/...'` import
// syntax only — not prose mentioning the path (e.g. this file's own doc
// comments use backticks, which this pattern deliberately does not match).
const FORBIDDEN_IMPORT_PATTERN = /from\s+["']@\/lib\/(live|interviews)/;

/** Removes comments so a doc block explaining the rule is not read as a violation. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("employer candidate views never import candidate-private Live/Prep data", () => {
  for (const file of EMPLOYER_DOMAIN_FILES) {
    it(`${file} does not import from @/lib/live or @/lib/interviews`, () => {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(FORBIDDEN_IMPORT_PATTERN);
    });
  }
});

describe("the employer candidate display type has no candidate-private field", () => {
  const FORBIDDEN_KEYS = [
    "transcript",
    "liveGuidance",
    "mockInterview",
    "postInterviewAnalysis",
    "interviewPrep",
    "liveSession",
    "prepBriefing",
  ];

  it("CandidateDetail declares none of them", () => {
    const source = readFileSync("src/lib/employers/types.ts", "utf8");
    // Read the CandidateDetail declaration rather than the whole file: other
    // types in the module may legitimately mention unrelated fields.
    const match = source.match(/export type CandidateDetail[\s\S]*?\n\};/);
    expect(match, "CandidateDetail declaration should be present").not.toBeNull();
    for (const key of FORBIDDEN_KEYS) {
      expect(match![0], `CandidateDetail must not declare ${key}`).not.toContain(key);
    }
  });

  it("the candidates adapter only maps fields the hiring backend returns", () => {
    // The adapter projects the backend's applicant payload. Asserting the
    // projection cannot invent a candidate-private value keeps the guarantee
    // at the mapping layer, not only at the type layer.
    //
    // Comments are stripped first: the adapter's own doc block names these
    // fields to explain why they are absent, and that explanation is prose
    // about the rule, not a mapping of the data.
    const source = stripComments(
      readFileSync("src/lib/employers/candidates-adapter.ts", "utf8")
    );
    for (const key of FORBIDDEN_KEYS) {
      expect(source, `candidates adapter must not map ${key}`).not.toContain(key);
    }
  });
});
