/**
 * Featured job listings — the real backend read.
 *
 * The package list itself is pure approved data and lives in
 * `./featured-packages`, which is client-safe; this module holds only the
 * server-side read of the organization's current featured state.
 *
 * What was a stub is the purchase, and it now starts a real Stripe checkout
 * through the org's featured route (see `./actions`).
 *
 * The important rule: **nothing here marks a job featured.** A featured
 * listing only becomes active when the billing webhook confirms payment and
 * calls `odesseus_create_featured_listing`. Until then the job's own
 * `featured` flag is unchanged, and this adapter reports that honestly rather
 * than optimistically flipping it. F13-O: never mark a listing featured before
 * backend confirmation.
 */

import { createClient } from "@/lib/supabase/server";
import { getOrgFeaturedView } from "@/lib/employer/service";
import { resolveEmployerContext } from "./context";
import { getFeaturedJobPackages, type FeaturedJobOverview } from "./featured-packages";
import type { EmployerResult } from "./result";

export {
  getFeaturedJobPackages,
  type FeaturedJobPackage,
  type FeaturedJobOverview,
  type FeaturedListingView,
} from "./featured-packages";

/** The organization's featured state, read from the backend. */
export async function getFeaturedOverview(): Promise<EmployerResult<FeaturedJobOverview>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  try {
    const supabase = await createClient();
    const view = await getOrgFeaturedView(
      supabase,
      resolved.context.orgId,
      resolved.context.userId
    );

    return {
      status: "ok",
      source: "live",
      data: {
        listings: view.listings.map((listing) => ({
          id: listing.id,
          jobId: listing.jobId,
          tier: listing.tier,
          isBoosted: listing.isBoosted,
          startsAt: listing.startsAt,
          expiresAt: listing.expiresAt,
        })),
        jobs: view.jobs,
        packages: getFeaturedJobPackages(),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_FEATURED] read failed", message);
    return { status: "unavailable", reason: "Odesseus could not load your promotions." };
  }
}
