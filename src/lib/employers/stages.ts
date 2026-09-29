/**
 * Pipeline stage vocabulary.
 *
 * The backend stores stages lowercase (`employer_pipeline_stages.stage`) and
 * types them as its own lowercase `PipelineStage`. The Figma components and the
 * locked product vocabulary are uppercase. This module is the single place the
 * two are translated, so the candidates and pipeline adapters cannot disagree
 * about which stage an applicant is in — a disagreement that would show one
 * applicant in two different columns at once.
 *
 * The stage set is locked. Do not add, remove, or reorder it: the database
 * check constraint, the pipeline API route, and the product spec all agree on
 * exactly these seven.
 */

import type { PipelineStage } from "./types";

/** The values as stored in the database, in pipeline order. */
export const STORED_STAGES = [
  "applied",
  "reviewing",
  "shortlisted",
  "interview",
  "offer",
  "hired",
  "rejected",
] as const;

export type StoredStage = (typeof STORED_STAGES)[number];

/** Narrows an unknown value to the backend's stored vocabulary. */
export function isStoredStage(value: unknown): value is StoredStage {
  return typeof value === "string" && (STORED_STAGES as readonly string[]).includes(value);
}

/** Stored lowercase -> the product's uppercase stage. */
export function toProductStage(stored: StoredStage): PipelineStage {
  return stored.toUpperCase() as PipelineStage;
}

/** The product's uppercase stage -> the stored lowercase value. */
export function toStoredStage(stage: PipelineStage): StoredStage {
  return stage.toLowerCase() as StoredStage;
}

/**
 * The stage an applicant is in when no pipeline history exists.
 *
 * "Applied" is the state the backend's own `currentStages` implies for an
 * applicant with no history row — it is the entry point of the pipeline, not a
 * client-side guess.
 */
export const DEFAULT_STAGE: PipelineStage = "APPLIED";

/** Human labels, matching the Pipeline screen's own vocabulary. */
export const STAGE_LABELS: Record<PipelineStage, string> = {
  APPLIED: "Applied",
  REVIEWING: "Reviewing",
  SHORTLISTED: "Shortlisted",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  HIRED: "Hired",
  REJECTED: "Rejected",
};
