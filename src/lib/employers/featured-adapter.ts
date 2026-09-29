/**
 * INTEGRATION POINT — featured job purchase backend (OpenCode Phase 2P-2S,
 * not yet shipped). Package definitions themselves are locked pricing data
 * (`PROMOTION_PLANS`), not a fixture — no production gate needed. The
 * purchase action never gets a fixture path: never mark a job featured until
 * the backend confirms it (F13-O).
 */
import { PROMOTION_PLANS } from "@/lib/pricing/candidate-pricing";
import type { FeaturedJobPackageId, FeaturedJobPurchase } from "./types";
import type { EmployerResult } from "./result";

export type FeaturedJobPackage = {
  id: FeaturedJobPackageId;
  name: string;
  priceLabel: string;
  unit: string;
};

const PACKAGE_IDS: FeaturedJobPackageId[] = ["featured-7", "featured-14", "ai-featured-30"];

export function getFeaturedJobPackages(): FeaturedJobPackage[] {
  return PROMOTION_PLANS.map((plan, i) => ({
    id: PACKAGE_IDS[i],
    name: plan.name,
    priceLabel: plan.priceLabel,
    unit: plan.unit,
  }));
}

/** INTEGRATION POINT: replace with a real checkout + featured-status call once the backend ships. */
export async function purchaseFeaturedJob(
  _jobId: string,
  _packageId: FeaturedJobPackageId
): Promise<EmployerResult<FeaturedJobPurchase>> {
  return { status: "unavailable", reason: "Purchasing a featured listing is not yet available." };
}
