import type { NormalizedJobPosting } from "./types";

type Preferences = {
  target_titles: string[];
  target_locations: string[];
  employment_types: string[];
  remote_only: boolean;
};

const stopWords = new Set([
  "and","the","a","an","of","for","to","with","in","on","at","sr","jr","senior","lead","manager","director"
]);

function tokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9+.#-]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1 && !stopWords.has(token))
  );
}

function hasOverlap(a: string, b: string) {
  const left = tokens(a);
  const right = tokens(b);
  for (const token of left) {
    if (right.has(token)) return true;
  }
  return false;
}

export function passesPreferencePrefilter(
  job: NormalizedJobPosting,
  preferences: Preferences | null
) {
  if (!preferences) return true;

  if (preferences.remote_only && job.workArrangement !== "remote") {
    return false;
  }

  if (preferences.target_titles?.length) {
    const titleMatch = preferences.target_titles.some((title) =>
      hasOverlap(title, job.title)
    );
    if (!titleMatch) return false;
  }

  if (preferences.employment_types?.length && job.employmentType) {
    const normalized = job.employmentType.toLowerCase().replace(/[^a-z]/g, "");
    const allowed = preferences.employment_types.some((type) =>
      normalized.includes(type.toLowerCase().replace(/[^a-z]/g, ""))
    );
    if (!allowed) return false;
  }

  return true;
}
