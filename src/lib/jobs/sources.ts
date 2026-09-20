import { z } from "zod";
import type { JobSourceConfig } from "./types";

const sourceSchema = z.object({
  provider: z.enum(["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "recruitee"]),
  companyName: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(200),
  region: z.enum(["global", "eu"]).optional(),
  tokenEnv: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,100}$/).optional(),
});

const sourceListSchema = z.array(sourceSchema).max(500);

export function configuredJobSources(): JobSourceConfig[] {
  const raw = process.env.ODYSSEUS_JOB_SOURCES_JSON?.trim();
  if (!raw) return [];

  try {
    return sourceListSchema.parse(JSON.parse(raw));
  } catch (error) {
    console.error("[ODYSSEUS_JOB_DISCOVERY] invalid source catalog", error);
    return [];
  }
}

export function sourceKey(source: JobSourceConfig) {
  return `${source.provider}:${source.slug.toLowerCase()}`;
}
