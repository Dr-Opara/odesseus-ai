import { describe, expect, it } from "vitest";
import {
  classifyQuestionSensitivity,
  findEquivalentVaultEntry,
  normalizeQuestionIntent,
  type VaultEntry,
} from "@/lib/apply/answer-vault";

describe("classifyQuestionSensitivity", () => {
  const sensitiveExamples: Array<[string, string]> = [
    ["What is your race or ethnicity?", "race_ethnicity"],
    ["What is your gender?", "sex_gender"],
    ["Do you identify as LGBTQ+?", "sexual_orientation"],
    ["Do you have a disability?", "disability"],
    ["Are you a protected veteran?", "veteran_status"],
    ["What is your religion?", "religion"],
    ["Have you ever been convicted of a felony?", "criminal_history"],
    ["I certify that the information above is true.", "legal_attestation"],
    ["What is your Social Security Number?", "identity_verification"],
    ["Do you have any medical conditions we should know about?", "medical"],
    ["What was your salary at your last job?", "salary_history"],
    ["Do you hold an active security clearance?", "clearance"],
    ["What is your current work authorization status?", "ambiguous_work_authorization"],
  ];

  it.each(sensitiveExamples)("classifies %s as sensitive (%s)", (question, category) => {
    expect(classifyQuestionSensitivity(question)).toEqual({ tier: "sensitive", category });
  });

  it("classifies an ordinary application question as standard", () => {
    expect(classifyQuestionSensitivity("Are you authorized to work in the US?")).toEqual({
      tier: "standard",
      category: null,
    });
    expect(classifyQuestionSensitivity("What is your expected salary?")).toEqual({
      tier: "standard",
      category: null,
    });
  });
});

describe("normalizeQuestionIntent", () => {
  it("produces the same canonical form regardless of word order", () => {
    expect(normalizeQuestionIntent("Are you authorized to work in the US?")).toEqual(
      normalizeQuestionIntent("In the US, are you authorized to work?")
    );
  });

  it("is stable under punctuation and case differences", () => {
    expect(normalizeQuestionIntent("What is your expected salary?")).toBe(
      normalizeQuestionIntent("what is your expected salary")
    );
  });
});

function vaultEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    answer_key: "work_authorization_us",
    label: "Are you authorized to work in the US?",
    category: "work_authorization",
    answer_text: "Yes, I am a US citizen.",
    auto_use_allowed: true,
    ...overrides,
  };
}

describe("findEquivalentVaultEntry", () => {
  it("reuses an approved answer for a materially equivalent, differently-worded question", () => {
    const entries = [vaultEntry({ normalized_intent: normalizeQuestionIntent(vaultEntry().label) })];
    const match = findEquivalentVaultEntry("Are you legally authorized to work in the US", entries);
    expect(match?.answer_key).toBe("work_authorization_us");
  });

  it("does not reuse an answer for a non-equivalent question", () => {
    const entries = [vaultEntry({ normalized_intent: normalizeQuestionIntent(vaultEntry().label) })];
    const match = findEquivalentVaultEntry("What is your expected start date?", entries);
    expect(match).toBeNull();
  });

  it("never reuses any vault entry for a sensitive question, even with high textual overlap", () => {
    const entries = [
      vaultEntry({
        label: "What was your salary expectation?",
        answer_key: "salary_expectation",
        category: "salary",
        answer_text: "$150,000",
        normalized_intent: normalizeQuestionIntent("What was your salary expectation?"),
      }),
    ];

    // "salary history" is a distinct, sensitive question from "salary
    // expectation" even though the words overlap heavily — it must never be
    // silently answered from a vault entry approved for a different intent.
    const match = findEquivalentVaultEntry("What was your salary at your last job?", entries);
    expect(match).toBeNull();
  });

  it("ignores a vault entry that is not marked auto_use_allowed", () => {
    const entries = [vaultEntry({ auto_use_allowed: false })];
    expect(findEquivalentVaultEntry(vaultEntry().label, entries)).toBeNull();
  });

  it("defensively refuses to match a vault entry whose own label is sensitive, even if flagged reusable", () => {
    const entries = [
      vaultEntry({
        label: "What is your race or ethnicity?",
        answer_key: "race_leaked",
        auto_use_allowed: true,
        normalized_intent: normalizeQuestionIntent("What is your race or ethnicity?"),
      }),
    ];
    expect(findEquivalentVaultEntry("What is your race or ethnicity?", entries)).toBeNull();
  });
});
