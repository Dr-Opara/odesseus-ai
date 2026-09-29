import type { PipelineStage } from "@/lib/employers/types";

const STAGE_LABELS: Record<PipelineStage, string> = {
  APPLIED: "Applied",
  REVIEWING: "Reviewing",
  SHORTLISTED: "Shortlisted",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  HIRED: "Hired",
  REJECTED: "Rejected",
};

/** Consistent pill rendering of a locked pipeline stage (F13-K), reused by the candidates list, candidate detail, and pipeline board. */
export default function PipelineStageBadge({ stage }: { stage: PipelineStage }) {
  return <span className={`emp-stage-badge emp-stage-${stage.toLowerCase()}`}>{STAGE_LABELS[stage]}</span>;
}
