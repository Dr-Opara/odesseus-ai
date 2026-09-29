import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CANDIDATE_FIXTURES } from "@/lib/employers/fixtures/candidates";

// F13-J: candidate-private Odesseus Live/Interview Prep data must never reach
// an employer view. Belt-and-suspenders on top of the type-level exclusion in
// src/lib/employers/types.ts — this asserts the source files themselves never
// import from the candidate-private domains, and that no fixture entry smuggles
// a Live/Prep-shaped field in under an unexpected key.

const EMPLOYER_DOMAIN_FILES = [
  "src/lib/employers/types.ts",
  "src/lib/employers/candidates-adapter.ts",
  "src/lib/employers/fixtures/candidates.ts",
  "src/components/employers/fit-score-panel.tsx",
];

// Matches real `from "@/lib/live"` / `from '@/lib/interviews/...'` import
// syntax only — not prose mentioning the path (e.g. this file's own doc
// comments use backticks, which this pattern deliberately does not match).
const FORBIDDEN_IMPORT_PATTERN = /from\s+["']@\/lib\/(live|interviews)/;

describe("employer candidate views never import candidate-private Live/Prep data", () => {
  for (const file of EMPLOYER_DOMAIN_FILES) {
    it(`${file} does not import from @/lib/live or @/lib/interviews`, () => {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(FORBIDDEN_IMPORT_PATTERN);
    });
  }

  it("no candidate fixture entry has a transcript/guidance/mock-interview/post-interview-analysis field", () => {
    const forbiddenKeys = ["transcript", "liveGuidance", "mockInterview", "postInterviewAnalysis", "interviewPrep"];
    for (const candidate of CANDIDATE_FIXTURES) {
      for (const key of forbiddenKeys) {
        expect(candidate).not.toHaveProperty(key);
      }
    }
  });
});
