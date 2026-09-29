/**
 * Serialisation between the Figma job form and the backend's `employer_jobs`
 * columns.
 *
 * The form collects more than the table stores. `employer_jobs` has columns
 * for title, location, work arrangement, description, requirements text, and
 * preferred text — but no column for department, employment type,
 * compensation, or responsibilities.
 *
 * Those four are therefore folded into the description as labelled blocks
 * rather than discarded. The alternative — dropping them — would silently
 * lose what the employer typed, and inventing columns would be a schema
 * change this module should not make unilaterally.
 *
 * The format round-trips: `parseJobDescription` reads back exactly what
 * `buildJobDescription` wrote, so the Edit form re-renders the employer's own
 * input into the same fields instead of showing a flattened blob.
 */

/** Labels for the folded fields. Stable: the parser matches on these. */
const DEPARTMENT = "Department";
const EMPLOYMENT_TYPE = "Employment type";
const COMPENSATION = "Compensation";
const RESPONSIBILITIES = "Responsibilities";

export type JobDescriptionParts = {
  /** The employer's free-text role summary. */
  body?: string;
  department?: string;
  employmentType?: string;
  compensationText?: string;
  /** One item per line. */
  responsibilities?: string[];
};

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Builds the stored description.
 *
 * Returns `null` when the employer supplied nothing, so an untouched field is
 * not written as an empty string.
 */
export function buildJobDescription(parts: JobDescriptionParts): string | null {
  const body = parts.body?.trim();
  const responsibilities = (parts.responsibilities ?? []).filter((line) => line.trim());

  const blocks: string[] = [];
  if (body) blocks.push(body);

  const department = blankToUndefined(parts.department);
  if (department) blocks.push(`${DEPARTMENT}: ${department}`);

  const employmentType = blankToUndefined(parts.employmentType);
  if (employmentType) blocks.push(`${EMPLOYMENT_TYPE}: ${employmentType}`);

  const compensation = blankToUndefined(parts.compensationText);
  if (compensation) blocks.push(`${COMPENSATION}: ${compensation}`);

  if (responsibilities.length) {
    blocks.push(`${RESPONSIBILITIES}:\n${responsibilities.map((line) => line.trim()).join("\n")}`);
  }

  const joined = blocks.join("\n\n").trim();
  return joined || null;
}

/** Reads a stored description back into the form's own fields. */
export function parseJobDescription(description: string | null | undefined): JobDescriptionParts {
  if (!description) return {};

  const body: string[] = [];
  const responsibilities: string[] = [];
  let department: string | undefined;
  let employmentType: string | undefined;
  let compensationText: string | undefined;
  let inResponsibilities = false;

  for (const raw of description.split("\n")) {
    // An exact label match starts (or restarts) a folded block. `startsWith`
    // is deliberate: "Department: Engineering" matches, "Departmental: x"
    // does not.
    const singleLine = matchLabel(raw);
    if (singleLine) {
      inResponsibilities = false;
      if (singleLine.label === DEPARTMENT) department = singleLine.value;
      else if (singleLine.label === EMPLOYMENT_TYPE) employmentType = singleLine.value;
      else compensationText = singleLine.value;
      continue;
    }

    if (raw.trim() === `${RESPONSIBILITIES}:`) {
      inResponsibilities = true;
      continue;
    }

    if (inResponsibilities) {
      if (raw.trim()) responsibilities.push(raw.trim());
      continue;
    }

    body.push(raw);
  }

  return {
    body: body.join("\n").trim() || undefined,
    department,
    employmentType,
    compensationText,
    responsibilities: responsibilities.length ? responsibilities : undefined,
  };
}

/** Matches `Label: value` for the three single-line folded fields. */
function matchLabel(line: string): { label: string; value: string } | null {
  for (const label of [DEPARTMENT, EMPLOYMENT_TYPE, COMPENSATION]) {
    const prefix = `${label}:`;
    if (line.startsWith(prefix)) {
      return { label, value: line.slice(prefix.length).trim() };
    }
  }
  return null;
}

/**
 * Splits a stored requirements blob into display lines.
 *
 * The employer may have typed one item per line or a single sentence. Both
 * render as lines; nothing is parsed into a structure it did not have.
 */
export function splitRequirementLines(value: string | null | undefined): string[] | undefined {
  if (!value) return undefined;
  const lines = value
    .split("\n")
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
  return lines.length ? lines : undefined;
}
