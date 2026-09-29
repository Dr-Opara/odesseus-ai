/**
 * Featured job purchase adapter (F1). Package prices are locked product data
 * ($29 / 7 days, $49 / 14 days, $129 / 30 days AI Featured) and are also read
 * back from the backend's featured view, which returns the catalog amount the
 * checkout will actually charge.
 *
 * Purchasing starts a Stripe checkout. A job is never marked featured here:
 * visibility only begins once Stripe confirms payment and the backend creates
 * the listing, which the featured view then reflects.
 */
import { employerApi } from "./api-client";
import { featureEmployerJob } from "./jobs-adapter";
import type { FeaturedJobPackageId, FeaturedJobPurchase } from "./types";
import type { EmployerResult } from "./result";

export type FeaturedJobPackage = {
  id: FeaturedJobPackageId;
  name: string;
  priceLabel: string;
  unit: string;
  days: number;
};

/** Locked promotion packages, in the order the Figma screen shows them. */
const PACKAGES: FeaturedJobPackage[] = [
  { id: "featured_7d", name: "Featured", priceLabel: "$29", unit: "/ 7 days", days: 7 },
  { id: "featured_14d", name: "Featured", priceLabel: "$49", unit: "/ 14 days", days: 14 },
  { id: "ai_30d", name: "AI Featured", priceLabel: "$129", unit: "/ 30 days", days: 30 },
];

export function getFeaturedJobPackages(): FeaturedJobPackage[] {
  return PACKAGES;
}

export type FeaturedJobView = {
  listings: {
    id: string;
    jobId: string;
    jobTitle: string | null;
    tier: string;
    isActive: boolean;
    isBoosted: boolean;
    startsAt: string | null;
    expiresAt: string | null;
  }[];
  jobs: { id: string; title: string; location: string | null; status: string; isBoosted: boolean }[];
};

type BackendFeatured = {
  listings?: FeaturedJobView["listings"];
  jobs?: FeaturedJobView["jobs"];
};

/** What the org has already paid for, and which of its own jobs can be boosted. */
export async function getEmployerFeatured(orgId: string): Promise<EmployerResult<FeaturedJobView>> {
  const response = await employerApi<{ featured?: BackendFeatured }>(`/api/employer/orgs/${orgId}/featured`);
  if (response.ok) {
    return {
      status: "ok",
      source: "live",
      data: { listings: response.data?.featured?.listings ?? [], jobs: response.data?.featured?.jobs ?? [] },
    };
  }
  return { status: "unavailable", reason: response.reason };
}

/** Start the featured-listing checkout for one of the org's own jobs. */
export async function purchaseFeaturedJob(
  orgId: string,
  jobId: string,
  packageId: FeaturedJobPackageId
): Promise<EmployerResult<FeaturedJobPurchase>> {
  const result = await featureEmployerJob(orgId, jobId, packageId);
  if (result.status !== "ok") return result;
  return {
    status: "ok",
    source: "live",
    data: { checkoutUrl: result.data.checkoutUrl, jobId, packageId },
  };
}
