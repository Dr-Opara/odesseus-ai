import { describe, expect, it, vi, beforeEach } from "vitest";

const generateTextMock = vi.fn();

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
  Output: { object: (shape: unknown) => shape },
}));

vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn(() => ({})),
}));

describe("Live coding-interview guard (2N)", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    generateTextMock.mockResolvedValue({
      output: {
        isQuestion: true,
        questionText: "Tell me about yourself.",
        responseText: "Guidance.",
        structure: null,
        verifiedEvidence: ["Acme"],
        caution: null,
      },
    });
  });

  it("detects explicit coding requests", async () => {
    const { isCodingInterviewRequest } = await import("@/lib/ai/live-guidance");

    expect(isCodingInterviewRequest("Write code to implement this function")).toBe(true);
    expect(isCodingInterviewRequest("Help me debug this program, it will not compile")).toBe(true);
    expect(isCodingInterviewRequest("Solve this LeetCode dynamic programming problem")).toBe(true);
    expect(isCodingInterviewRequest("What is the time complexity, big-O, of binary search?")).toBe(true);
  });

  it("does not flag ordinary behavioral questions", async () => {
    const { isCodingInterviewRequest } = await import("@/lib/ai/live-guidance");

    expect(isCodingInterviewRequest("Tell me about a time you led a team through conflict.")).toBe(false);
    expect(isCodingInterviewRequest("Why do you want to work at Acme?")).toBe(false);
    expect(isCodingInterviewRequest("")).toBe(false);
  });

  it("returns the unsupported response without calling the model", async () => {
    const { generateLiveGuidance, LIVE_CODING_UNSUPPORTED_MESSAGE } = await import(
      "@/lib/ai/live-guidance"
    );

    const result = await generateLiveGuidance({
      transcript: "Implement a function to reverse a linked list in code.",
      mode: "default",
      context: { company: "Acme" },
    });

    expect(generateTextMock).not.toHaveBeenCalled();
    expect(result.responseText).toBeNull();
    expect(result.caution).toBe(LIVE_CODING_UNSUPPORTED_MESSAGE);
    expect(result.verifiedEvidence).toEqual([]);
    expect(result.isQuestion).toBe(true);
  });

  it("still calls the model for non-coding questions", async () => {
    const { generateLiveGuidance } = await import("@/lib/ai/live-guidance");

    const result = await generateLiveGuidance({
      transcript: "Tell me about a challenging project you completed.",
      mode: "default",
      context: { company: "Acme" },
    });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(result.responseText).toBe("Guidance.");
  });
});
