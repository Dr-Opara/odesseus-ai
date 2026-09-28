import { describe, expect, it } from "vitest";
import {
  APPLICATION_HOLD_CATEGORIES,
  classifyHoldReason,
  isApplicationHoldCategory,
  type ApplicationHoldCategory,
} from "@/lib/apply/runner";

/**
 * application_runs.hold_category is the structured reason a run is waiting on a
 * person. The database enforces that it is non-null exactly when the run is in
 * `needs_user`, so the classifier is what decides *what* a pause actually is —
 * including for the Application Agent, the dashboard's "needs attention" list,
 * and admin ops, none of which parse `stop_reason` prose.
 *
 * The strings below are the real `stop_reason` values the runner writes. If one
 * of them is reworded, its expected category has to be re-pointed here too,
 * which is the point: the test fails loudly rather than the column silently
 * becoming a wall of `needs_review`.
 */
const REAL_STOP_REASONS: Array<[string, ApplicationHoldCategory]> = [
  [
    "CAPTCHA or human-verification step detected.",
    "captcha_required",
  ],
  [
    "Authentication or human-verification step detected.",
    "mfa_required",
  ],
  [
    "Login, MFA, or verification step detected.",
    "mfa_required",
  ],
  [
    "Sensitive or unverified application questions need your input.",
    "sensitive_question",
  ],
  [
    "Odesseus needs your input for one or more application questions.",
    "needs_review",
  ],
  [
    "Odesseus could not identify the next or final application control. Review the page in the live browser.",
    "unsupported_flow",
  ],
  [
    "The submit action completed, but Odesseus could not verify a success confirmation. Please review the live browser before any credit is charged.",
    "unverified_submission",
  ],
  [
    "Your wallet needs $0.39 to finish a Standard Apply. Top up your wallet, then continue.",
    "insufficient_funds",
  ],
];

describe("classifyHoldReason", () => {
  it.each(REAL_STOP_REASONS)(
    "classifies %j as %s",
    (reason, expected) => {
      expect(classifyHoldReason(reason)).toBe(expected);
    }
  );

  it("returns a value inside the persisted domain for every real reason", () => {
    // The CHECK constraint on application_runs.hold_category is the source of
    // truth for the domain; this is the TypeScript mirror. Anything outside it
    // would be rejected by the database at the moment a run pauses.
    for (const [reason] of REAL_STOP_REASONS) {
      expect(APPLICATION_HOLD_CATEGORIES).toContain(classifyHoldReason(reason));
    }
  });

  describe("ordering: the specific signal wins over the broad one", () => {
    it("prefers sensitive over unverified, because that sentence contains the word 'unverified'", () => {
      // "Sensitive or unverified application questions need your input." is a
      // question that needs the applicant, not a submission that could not be
      // confirmed. Getting this backwards would tell the candidate their
      // application may have gone through when nothing was sent.
      expect(classifyHoldReason("Sensitive or unverified application questions need your input.")).toBe(
        "sensitive_question"
      );
    });

    it("prefers captcha over authentication when the page says verify you are human", () => {
      // Both categories stop the run and ask the human; only one of them is
      // true, and the Application Agent's queue is grouped by this value.
      expect(
        classifyHoldReason("CAPTCHA or human-verification step detected.")
      ).toBe("captcha_required");
      expect(
        classifyHoldReason("Authentication or human-verification step detected.")
      ).toBe("mfa_required");
    });

    it("prefers the wallet over everything else, because a top-up is the only action that unblocks it", () => {
      expect(
        classifyHoldReason(
          "Your wallet needs $0.99 to finish a Smart Apply. Top up your wallet, then continue."
        )
      ).toBe("insufficient_funds");
    });
  });

  it("is case-insensitive", () => {
    expect(classifyHoldReason("CAPTCHA or human-verification step detected.")).toBe(
      classifyHoldReason("captcha or human-verification step detected.")
    );
  });

  it("falls back to needs_review for an unrecognised pause rather than inventing a category", () => {
    // needs_review is the honest answer: a human needs to look. Guessing a
    // specific cause would be worse than saying so.
    expect(classifyHoldReason("Something happened that we have not seen before.")).toBe(
      "needs_review"
    );
    expect(classifyHoldReason("")).toBe("needs_review");
  });

  it("has no category meaning a human gate was bypassed", () => {
    // There is deliberately no value for "we got past a CAPTCHA" or "we got past
    // MFA", and the guarantee is structural: the persisted domain simply has no
    // such member, so no writer can record one. Guarding it here means adding a
    // bypass-flavoured category has to be an explicit, failing decision.
    const bypassFlavour = /bypass|evade|defeat|auto.?solve|passed|cleared|beaten/i;

    for (const category of APPLICATION_HOLD_CATEGORIES) {
      expect(bypassFlavour.test(category)).toBe(false);
    }
  });

  it("exposes the same domain at runtime and in the type system", () => {
    // The type is derived from the array, so a value added to one without the
    // other is not representable. isApplicationHoldCategory is the runtime guard
    // used wherever a category arrives from outside the runner.
    expect(APPLICATION_HOLD_CATEGORIES).toHaveLength(7);
    expect(new Set(APPLICATION_HOLD_CATEGORIES).size).toBe(APPLICATION_HOLD_CATEGORIES.length);

    for (const category of APPLICATION_HOLD_CATEGORIES) {
      expect(isApplicationHoldCategory(category)).toBe(true);
    }

    expect(isApplicationHoldCategory("captcha_bypassed")).toBe(false);
    expect(isApplicationHoldCategory("")).toBe(false);
    expect(isApplicationHoldCategory(null)).toBe(false);
    expect(isApplicationHoldCategory(undefined)).toBe(false);
    expect(isApplicationHoldCategory(7)).toBe(false);
  });
});
