import type { ResumeProfile, ResumeTailoringOutput } from "./schemas";

/**
 * Grounds a tailored resume against the verified source profile it was
 * derived from. This is a mechanical, non-LLM check: the tailoring prompt in
 * `tailor.ts` already instructs the model never to invent facts, but a
 * system prompt is not a guarantee. This function is the actual gate — a
 * fabricated skill, employer, certification, or an unverifiable evidence
 * citation fails here regardless of what the model claims about itself.
 */
export type GroundingViolation = {
  section: "skills" | "certifications" | "roles" | "changes";
  detail: string;
};

export type GroundingResult =
  | { ok: true }
  | { ok: false; violations: GroundingViolation[] };

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Every fact string the source resume actually supports, flattened for substring matching. */
function sourceFactCorpus(source: ResumeProfile): string {
  const parts: string[] = [
    source.summary,
    source.currentOrRecentTitle || "",
    ...source.industries,
    ...source.skills,
    ...source.certifications,
    ...source.verifiedFacts,
  ];

  for (const education of source.education) {
    parts.push(education.degree, education.field || "", education.institution || "");
  }

  for (const role of source.roles) {
    parts.push(
      role.title,
      role.company || "",
      ...role.responsibilities,
      ...role.achievements,
      ...role.skills
    );
  }

  return normalize(parts.filter(Boolean).join(" \n "));
}

function sourceSkillSet(source: ResumeProfile): Set<string> {
  const skills = new Set(source.skills.map(normalize));
  for (const role of source.roles) {
    for (const skill of role.skills) skills.add(normalize(skill));
  }
  return skills;
}

function sourceCertificationSet(source: ResumeProfile): Set<string> {
  return new Set(source.certifications.map(normalize));
}

/** A tailored role is legitimate only if it corresponds to a real source role by company + title. */
function matchesSourceRole(
  source: ResumeProfile,
  role: ResumeTailoringOutput["tailoredResume"]["roles"][number]
): boolean {
  return source.roles.some(
    (sourceRole) =>
      normalize(sourceRole.company || "") === normalize(role.company || "") &&
      normalize(sourceRole.title) === normalize(role.title) &&
      (sourceRole.start || null) === (role.start || null) &&
      (sourceRole.end || null) === (role.end || null)
  );
}

export function verifyResumeGrounding(
  source: ResumeProfile,
  output: ResumeTailoringOutput
): GroundingResult {
  const violations: GroundingViolation[] = [];
  const allowedSkills = sourceSkillSet(source);
  const allowedCertifications = sourceCertificationSet(source);
  const corpus = sourceFactCorpus(source);

  for (const skill of output.tailoredResume.skills) {
    if (!allowedSkills.has(normalize(skill))) {
      violations.push({ section: "skills", detail: `unsupported skill: "${skill}"` });
    }
  }

  for (const certification of output.tailoredResume.certifications) {
    if (!allowedCertifications.has(normalize(certification))) {
      violations.push({
        section: "certifications",
        detail: `unsupported certification: "${certification}"`,
      });
    }
  }

  for (const role of output.tailoredResume.roles) {
    if (!matchesSourceRole(source, role)) {
      violations.push({
        section: "roles",
        detail: `role does not match any verified source role: "${role.title}" at "${role.company ?? "unknown employer"}" (${role.start ?? "?"}–${role.end ?? "?"})`,
      });
    }
  }

  for (const change of output.changes) {
    const unsupported = change.verifiedEvidence.filter(
      (evidence) => !corpus.includes(normalize(evidence))
    );
    if (unsupported.length > 0) {
      violations.push({
        section: "changes",
        detail: `unverifiable evidence for a "${change.type}" change to "${change.section}": ${unsupported.map((e) => `"${e}"`).join(", ")}`,
      });
    }
  }

  return violations.length > 0 ? { ok: false, violations } : { ok: true };
}
