/**
 * Featured listing package data — client-safe.
 *
 * The package list and its prices are approved commercial data, read from the
 * billing catalog through the plan table. Nothing here is a fixture and
 * nothing here is gated by environment, so this module is safe to import from
 * a client component: it is pure data plus a pure mapping.
 *
 * The purchase itself lives in `@/lib/employers/actions` and is a Stripe
 * checkout. A featured listing only becomes active once the webhook confirms
 * payment and the backend activates it.
 */

import { FEATURED_OPTION_BY_TIER, type FeaturedTier } from "@/lib/employer/plans";
import type { FeaturedJobPackageId } from "./types";

export type FeaturedJobPackage = {
  id: FeaturedJobPackageId;
  /** The backend tier the checkout charges against. */
  tier: FeaturedTier;
  name: string;
  priceLabel: string;
  unit: string;
  days: number;
};

/** The Figma package ids, in the same order as the plan table's tiers. */
const PACKAGE_TIERS: Record<FeaturedJobPackageId, FeaturedTier> = {
  "featured-7": "featured_7d",
  "featured-14": "featured_14d",
  "ai-featured-30": "ai_30d",
};

/**
 * The three approved promotion packages.
 *
 * Prices and windows come from `FEATURED_OPTION_BY_TIER`, which mirrors the
 * billing catalog the checkout charges from — so the amount shown here and the
 * amount billed are the same number, not two copies.
 */
export function getFeaturedJobPackages(): FeaturedJobPackage[] {
  return (Object.keys(PACKAGE_TIERS) as FeaturedJobPackageId[]).map((id) => {
    const option = FEATURED_OPTION_BY_TIER[PACKAGE_TIERS[id]];
    return {
      id,
      tier: PACKAGE_TIERS[id],
      name: option.name,
      priceLabel: option.priceLabel,
      unit: option.unit,
      days: option.days,
    };
  });
}

export type FeaturedListingView = {
  id: string;
  jobId: string;
  tier: string;
  isBoosted: boolean;
  startsAt: string | null;
  expiresAt: string | null;
};

export type FeaturedJobOverview = {
  /** Promotions currently on file, from the backend's featured view. */
  listings: FeaturedListingView[];
  /** The org's jobs, with whether each is currently boosted. */
  jobs: { id: string; title: string; location: string | null; status: string; isBoosted: boolean }[];
  packages: FeaturedJobPackage[];
};
