import { z } from "zod";
import type { JobSourceConfig } from "./types";

const sourceSchema = z.object({
  provider: z.enum(["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "recruitee", "workday"]),
  companyName: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(200),
  region: z.enum(["global", "eu"]).optional(),
  tokenEnv: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,100}$/).optional(),
  careerUrl: z.string().url().max(500).optional(),
  maxJobs: z.number().int().min(1).max(200).optional(),
});

const sourceListSchema = z.array(sourceSchema).max(500);
const providerNames = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "smartrecruiters",
  "recruitee",
  "workday",
]);

function titleFromSlug(slug: string) {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeLegacySource(value: unknown): unknown {
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  const separator = trimmed.indexOf(":");
  if (separator <= 0) return value;

  const provider = trimmed.slice(0, separator).toLowerCase();
  const slug = trimmed.slice(separator + 1).trim();

  if (!providerNames.has(provider) || !slug) return value;

  return {
    provider,
    slug,
    companyName: titleFromSlug(slug),
  };
}

export function configuredJobSources(): JobSourceConfig[] {
  const raw =
    process.env.ODESSEUS_JOB_SOURCES_JSON?.trim() ||
    process.env.ODYSSEUS_JOB_SOURCES_JSON?.trim();

  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    const normalized = Array.isArray(parsed)
      ? parsed.map(normalizeLegacySource)
      : parsed;

    return sourceListSchema.parse(normalized);
  } catch (error) {
    console.error("[ODESSEUS_JOB_DISCOVERY] invalid source catalog", error);
    return [];
  }
}

export function sourceKey(source: JobSourceConfig) {
  return `${source.provider}:${source.slug.toLowerCase()}`;
}
