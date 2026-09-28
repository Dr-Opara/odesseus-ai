/**
 * Answer Vault safety layer: classifies a question's sensitivity and decides
 * whether a saved answer may be reused for a new, differently-worded
 * question. Both concerns live in one module because they share a single
 * rule: a question that classifies as sensitive is never auto-answered and
 * never reused from the vault, full stop — regardless of how similar it
 * looks to something already approved.
 *
 * Sensitivity is deliberately a plain-pattern classifier, not a model call:
 * "never auto-answer a sensitive question solely through model inference" is
 * a requirement on this exact boundary, so the boundary itself must not
 * depend on inference.
 */

export type SensitivityTier = "standard" | "sensitive";

export type SensitivityClassification = {
  tier: SensitivityTier;
  /** Which named category matched, or null for a standard question. */
  category: string | null;
};

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\brace\b|ethnicit/i, category: "race_ethnicity" },
  { pattern: /\bgender\b|\bsex\b(?!ual orientation)|\bpronoun/i, category: "sex_gender" },
  { pattern: /sexual orientation|\blgbtq/i, category: "sexual_orientation" },
  { pattern: /disabilit/i, category: "disability" },
  { pattern: /veteran/i, category: "veteran_status" },
  { pattern: /religio/i, category: "religion" },
  {
    pattern: /criminal (history|record|background)|\bconvicted\b|\bfelony\b|\bmisdemeanor\b/i,
    category: "criminal_history",
  },
  {
    pattern: /\bcertify\b|\battest\b|under penalty of perjury|legally binding signature/i,
    category: "legal_attestation",
  },
  {
    pattern: /social security|\bssn\b|passport number|national id|date of birth|birth ?date/i,
    category: "identity_verification",
  },
  { pattern: /medical|health condition|disability accommodation/i, category: "medical" },
  {
    pattern: /salary history|prior salary|current salary|previous (salary|compensation)|salary at your (last|current|previous)/i,
    category: "salary_history",
  },
  { pattern: /security clearance|clearance level|active clearance/i, category: "clearance" },
];

/**
 * Ambiguous work-authorization phrasing that does not cleanly map to the
 * straightforward "are you authorized to work in X" question Odesseus
 * already answers from explicit candidate preferences. Treated as sensitive
 * rather than guessed.
 */
const AMBIGUOUS_WORK_AUTH_PATTERN =
  /work authorization status|immigration status|visa status(?! sponsorship)/i;

export function classifyQuestionSensitivity(question: string): SensitivityClassification {
  for (const { pattern, category } of SENSITIVE_PATTERNS) {
    if (pattern.test(question)) return { tier: "sensitive", category };
  }
  if (AMBIGUOUS_WORK_AUTH_PATTERN.test(question)) {
    return { tier: "sensitive", category: "ambiguous_work_authorization" };
  }
  return { tier: "standard", category: null };
}

// Deliberately excludes "us" — it is also the ISO country code for the
// United States, and stripping it would make "work in the US" and "work in
// the UK" collide with each other once the country token is gone.
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "you", "your", "do", "does", "did", "to", "for", "of",
  "in", "on", "at", "this", "that", "please", "we", "our", "i",
]);

/** Deterministic canonical form of a question, used for equivalence matching. */
export function normalizeQuestionIntent(question: string): string {
  const tokens = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));

  return Array.from(new Set(tokens)).sort().join(" ");
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/** A question counts as materially equivalent above this token-overlap ratio. */
const EQUIVALENCE_THRESHOLD = 0.7;

export type VaultEntry = {
  answer_key: string;
  label: string;
  category: string;
  answer_text: string;
  auto_use_allowed: boolean;
  normalized_intent?: string | null;
};

/**
 * Finds a vault entry that is materially equivalent to `question`, or null.
 * A sensitive question never matches, no matter how textually similar an
 * existing vault entry looks — sensitivity is checked before similarity.
 */
export function findEquivalentVaultEntry(
  question: string,
  entries: VaultEntry[]
): VaultEntry | null {
  if (classifyQuestionSensitivity(question).tier === "sensitive") return null;

  const questionIntent = normalizeQuestionIntent(question);
  const questionTokens = new Set(questionIntent.split(" ").filter(Boolean));

  let best: { entry: VaultEntry; score: number } | null = null;

  for (const entry of entries) {
    if (!entry.auto_use_allowed) continue;
    // Defense in depth: a sensitive answer should never have been written to
    // the vault, but this boundary never trusts that invariant blindly.
    if (classifyQuestionSensitivity(entry.label).tier === "sensitive") continue;

    const entryIntent = entry.normalized_intent || normalizeQuestionIntent(entry.label);
    if (entryIntent === questionIntent) return entry;

    const entryTokens = new Set(entryIntent.split(" ").filter(Boolean));
    const score = jaccardSimilarity(questionTokens, entryTokens);
    if (score >= EQUIVALENCE_THRESHOLD && (!best || score > best.score)) {
      best = { entry, score };
    }
  }

  return best?.entry ?? null;
}
