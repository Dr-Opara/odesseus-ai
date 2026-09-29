/**
 * The legacy labelled-description format, and reading it.
 *
 * When `employer_jobs` had no columns for department, employment type,
 * compensation, or responsibilities, the employer form folded them into
 * `description` as a labelled block:
 *
 *     Own application security.
 *
 *     Department: Engineering
 *
 *     Compensation: $180K-$220K
 *
 *     Responsibilities:
 *     Threat modelling
 *     Secure code review
 *
 * Those four fields are real columns now. Nothing writes this format any more,
 * and `buildJobDescription` is deliberately absent so it cannot be reintroduced
 * by accident.
 *
 * What is left here is the read path, and it earns its place: a description
 * predating the migration may exist only in this shape, and a row whose column
 * is still null but whose block is recognisable is one the backfill did not
 * reach. Dropping the parse would turn those jobs' fields into silently
 * missing values.
 *
 * Nothing here alters a description. The block is left in the stored text
 * because removing text an employer wrote is a worse failure than a redundant
 * field, and the read path prefers the column in any case.
 */

/** Labels the legacy serialiser wrote. Stable: the parser matches on these. */
const DEPARTMENT = "Department";
const EMPLOYMENT_TYPE = "Employment type";
const COMPENSATION = "Compensation";
const RESPONSIBILITIES = "Responsibilities";

export type JobDescriptionParts = {
  /** The employer's free-text role summary, with the folded blocks removed. */
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
 * Splits a legacy description into its free-text body and folded fields.
 *
 * A single pass, so a folded block cannot be mistaken for body text and the
 * body cannot swallow a folded block. Returns `{}` for an absent description.
 */
export function parseJobDescription(
  description: string | null | undefined
): JobDescriptionParts {
  if (!description) return {};

  const body: string[] = [];
  const responsibilities: string[] = [];
  let department: string | undefined;
  let employmentType: string | undefined;
  let compensationText: string | undefined;
  let inResponsibilities = false;

  for (const raw of description.split("\n")) {
    // `startsWith` on the full label is deliberate: "Department: Engineering"
    // matches, "Departmental: x" does not.
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
    department: blankToUndefined(department),
    employmentType: blankToUndefined(employmentType),
    compensationText: blankToUndefined(compensationText),
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
export function splitRequirementLines(
  value: string | null | undefined
): string[] | undefined {
  if (!value) return undefined;
  const lines = value
    .split("\n")
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
  return lines.length ? lines : undefined;
}
