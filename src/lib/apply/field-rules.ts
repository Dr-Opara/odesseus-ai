export type ApplyContext = {
  profile: Record<string, any>;
  preferences: Record<string, any> | null;
  vault: Array<{
    answer_key: string;
    label: string;
    category: string;
    answer_text: string;
    auto_use_allowed: boolean;
  }>;
  email: string | null;
};

export type FieldDecision =
  | { action: "fill"; value: string; source: "profile" | "vault"; key: string }
  | { action: "pause"; category: string; reason: string }
  | { action: "skip"; reason: string };

const sensitivePatterns = [
  /race|ethnic|gender|sex|pronoun|veteran|disabilit|religion|marital|sexual orientation/i,
  /social security|ssn|date of birth|birth date|national id|passport/i,
];

const authPatterns = [
  /password|verification code|one[- ]?time|otp|security code|captcha|human verification/i,
];

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function decideField(label: string, type: string, context: ApplyContext): FieldDecision {
  const key = normalized(label);

  if (sensitivePatterns.some((pattern) => pattern.test(label))) {
    return { action: "pause", category: "sensitive", reason: "Sensitive demographic or identity question requires the user." };
  }

  if (type === "password" || authPatterns.some((pattern) => pattern.test(label))) {
    return { action: "pause", category: "custom", reason: "Authentication or verification requires the user." };
  }

  const vault = context.vault.find((item) => {
    const itemKey = normalized(item.answer_key + " " + item.label);
    return item.auto_use_allowed && (key.includes(normalized(item.answer_key)) || itemKey.includes(key));
  });

  if (vault) {
    return { action: "fill", value: vault.answer_text, source: "vault", key: vault.answer_key };
  }

  const fullName = context.profile?.full_name || "";
  const nameParts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";

  if (/first name|given name/.test(key) && firstName) return { action: "fill", value: firstName, source: "profile", key: "first_name" };
  if (/last name|family name|surname/.test(key) && lastName) return { action: "fill", value: lastName, source: "profile", key: "last_name" };
  if (/full name|legal name/.test(key) && fullName) return { action: "fill", value: fullName, source: "profile", key: "full_name" };
  if (/email/.test(key) && context.email) return { action: "fill", value: context.email, source: "profile", key: "email" };
  if (/location|city/.test(key) && context.profile?.location) return { action: "fill", value: context.profile.location, source: "profile", key: "location" };
  if (/linkedin/.test(key) && context.profile?.linkedin_url) return { action: "fill", value: context.profile.linkedin_url, source: "profile", key: "linkedin" };
  if (/github/.test(key) && context.profile?.github_url) return { action: "fill", value: context.profile.github_url, source: "profile", key: "github" };
  if (/portfolio|website/.test(key) && context.profile?.portfolio_url) return { action: "fill", value: context.profile.portfolio_url, source: "profile", key: "portfolio" };

  if (/authorized to work|work authorization|legally authorized/.test(key) && context.preferences?.work_authorization) {
    return { action: "fill", value: context.preferences.work_authorization, source: "profile", key: "work_authorization" };
  }

  if (/sponsorship|visa sponsorship/.test(key) && typeof context.preferences?.sponsorship_needed === "boolean") {
    return { action: "fill", value: context.preferences.sponsorship_needed ? "Yes" : "No", source: "profile", key: "sponsorship" };
  }

  if (/salary|compensation|pay expectation/.test(key) && context.preferences?.minimum_salary) {
    return { action: "fill", value: String(context.preferences.minimum_salary), source: "profile", key: "minimum_salary" };
  }

  if (/phone|mobile/.test(key)) {
    return { action: "pause", category: "contact", reason: "Phone number is not verified in the current Odysseus profile." };
  }

  return { action: "pause", category: "custom", reason: "Odysseus does not have a pre-approved answer for this question." };
}
