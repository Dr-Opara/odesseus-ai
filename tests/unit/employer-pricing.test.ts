import { describe, expect, it } from "vitest";
import {
  EXTRA_RECRUITER_SEAT_PRICE_LABEL,
  FEATURED_OPTION_BY_TIER,
  FEATURED_TIERS,
  EMPLOYER_MEMBER_ROLES,
  EMPLOYER_PLAN_BY_TIER,
  EMPLOYER_TIERS,
  featuredOptionForTier,
  isActiveSubscriptionStatus,
  isEmployerJobStatus,
  isEmployerMemberRole,
  isEmployerTier,
  isFeaturedTier,
  jobStatusLabel,
  memberRoleLabel,
  planForTier,
  subscriptionStatusLabel,
} from "@/lib/employer/plans";
import {
  EMPLOYER_PLANS,
  PROMOTION_PLANS,
  RECRUITER_SEAT_PRICE_LABEL,
  RECRUITER_SEAT_UNIT,
} from "@/lib/pricing/candidate-pricing";

/**
 * The approved employer commercial terms, pinned.
 *
 * These numbers are the contract with a paying employer. A refactor that quietly
 * changes a price or an included job-post count is a pricing change, so it must
 * fail a test rather than reach a signed-in customer's invoice screen.
 */
describe("employer plan terms (approved pricing)", () => {
  it("prices the three subscriptions exactly as approved", () => {
    expect(EMPLOYER_PLAN_BY_TIER.starter.priceUsd).toBe(79);
    expect(EMPLOYER_PLAN_BY_TIER.growth.priceUsd).toBe(149);
    expect(EMPLOYER_PLAN_BY_TIER.business.priceUsd).toBe(299);
  });

  it("includes 3 / 10 / 25 job posts as approved", () => {
    expect(EMPLOYER_PLAN_BY_TIER.starter.jobPostsIncluded).toBe(3);
    expect(EMPLOYER_PLAN_BY_TIER.growth.jobPostsIncluded).toBe(10);
    expect(EMPLOYER_PLAN_BY_TIER.business.jobPostsIncluded).toBe(25);
  });

  it("prices an additional recruiter seat at $20/month", () => {
    expect(EXTRA_RECRUITER_SEAT_PRICE_LABEL).toBe("$20");
  });

  it("prices the three promotions as approved", () => {
    expect(FEATURED_OPTION_BY_TIER.featured_7d.priceUsd).toBe(29);
    expect(FEATURED_OPTION_BY_TIER.featured_7d.days).toBe(7);
    expect(FEATURED_OPTION_BY_TIER.featured_14d.priceUsd).toBe(49);
    expect(FEATURED_OPTION_BY_TIER.featured_14d.days).toBe(14);
    expect(FEATURED_OPTION_BY_TIER.ai_30d.priceUsd).toBe(129);
    expect(FEATURED_OPTION_BY_TIER.ai_30d.days).toBe(30);
    expect(FEATURED_OPTION_BY_TIER.ai_30d.name).toBe("AI Featured");
  });

  /**
   * The employer portal and the public pricing page are two renderings of one
   * set of terms. This guard is what stops them from drifting: the public
   * catalogue is display-only copy, the portal module is the data the signed-in
   * dashboard renders, and a mismatch means an employer is quoted one number
   * publicly and shown another after signing in.
   */
  it("agrees with the public pricing catalogue", () => {
    const publicPlans = [...EMPLOYER_PLANS].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const portalPlans = EMPLOYER_TIERS.map((tier) => EMPLOYER_PLAN_BY_TIER[tier]).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    expect(portalPlans.map((plan) => plan.name)).toEqual(
      publicPlans.map((plan) => plan.name)
    );
    for (const [index, publicPlan] of publicPlans.entries()) {
      expect(portalPlans[index].priceLabel).toBe(publicPlan.priceLabel);
      expect(portalPlans[index].unit).toBe(publicPlan.unit);
      // The public page says "N active jobs"; the portal needs the same N as an
      // integer, so the two are cross-checked rather than trusted separately.
      expect(publicPlan.jobs).toBe(
        `${portalPlans[index].jobPostsIncluded} active jobs`
      );
    }
  });

  it("agrees with the public promotion catalogue", () => {
    const publicPromotions = PROMOTION_PLANS.map(
      (plan) => `${plan.name} ${plan.unit} ${plan.priceLabel}`
    );
    const portalPromotions = FEATURED_TIERS.map(
      (tier) => `${FEATURED_OPTION_BY_TIER[tier].name} ${FEATURED_OPTION_BY_TIER[tier].unit} ${FEATURED_OPTION_BY_TIER[tier].priceLabel}`
    );

    expect([...portalPromotions].sort()).toEqual([...publicPromotions].sort());
  });

  it("agrees with the public recruiter seat price and unit", () => {
    expect(RECRUITER_SEAT_PRICE_LABEL).toBe(EXTRA_RECRUITER_SEAT_PRICE_LABEL);
    expect(RECRUITER_SEAT_UNIT).toBe("/month per additional seat");
  });
});

/**
 * The stored vocabulary is the contract with the database. These are the
 * check-constraint values in the live schema, and a mismatch here would mean
 * every plan lookup silently returns "not recognised".
 */
describe("employer stored vocabulary", () => {
  it("knows exactly the stored subscription tiers", () => {
    expect([...EMPLOYER_TIERS]).toEqual(["starter", "growth", "business"]);
  });

  it("knows exactly the stored member roles", () => {
    expect([...EMPLOYER_MEMBER_ROLES]).toEqual(["owner", "admin", "recruiter", "viewer"]);
  });

  it("knows exactly the stored featured tiers", () => {
    expect([...FEATURED_TIERS]).toEqual(["featured_7d", "featured_14d", "ai_30d"]);
  });

  it("narrows stored tiers it recognises", () => {
    expect(isEmployerTier("starter")).toBe(true);
    expect(isEmployerTier("enterprise")).toBe(false);
    expect(isEmployerTier("")).toBe(false);

    expect(isEmployerMemberRole("owner")).toBe(true);
    expect(isEmployerMemberRole("superuser")).toBe(false);

    expect(isEmployerJobStatus("published")).toBe(true);
    expect(isEmployerJobStatus("archived")).toBe(false);

    expect(isFeaturedTier("ai_30d")).toBe(true);
    expect(isFeaturedTier("ai_7d")).toBe(false);
  });
});

describe("employer plan and status resolution", () => {
  it("maps a stored tier onto its plan", () => {
    expect(planForTier("growth")?.name).toBe("Growth");
    expect(planForTier("business")?.jobPostsIncluded).toBe(25);
  });

  /**
   * The critical anti-fabrication rule: an unrecognised stored tier must yield
   * null, never a default plan. A silent fallback to Starter would tell a
   * Business customer they pay $79 and include 3 job posts.
   */
  it("returns null for an unrecognised or missing tier rather than defaulting", () => {
    expect(planForTier("enterprise")).toBeNull();
    expect(planForTier("")).toBeNull();
    expect(planForTier(null)).toBeNull();
    expect(planForTier(undefined)).toBeNull();
  });

  it("maps a stored featured tier onto its promotion, or null", () => {
    expect(featuredOptionForTier("ai_30d")?.priceLabel).toBe("$129");
    expect(featuredOptionForTier("ai_7d")).toBeNull();
    expect(featuredOptionForTier(null)).toBeNull();
  });

  /**
   * Only a live subscription entitles an organization to the included job
   * posts. `incomplete` means checkout never finished and `past_due` means a
   * payment failed; neither may be treated as paid.
   */
  it("treats only active and trialing subscriptions as live", () => {
    expect(isActiveSubscriptionStatus("active")).toBe(true);
    expect(isActiveSubscriptionStatus("trialing")).toBe(true);
    expect(isActiveSubscriptionStatus("past_due")).toBe(false);
    expect(isActiveSubscriptionStatus("incomplete")).toBe(false);
    expect(isActiveSubscriptionStatus("canceled")).toBe(false);
    expect(isActiveSubscriptionStatus(null)).toBe(false);
    expect(isActiveSubscriptionStatus(undefined)).toBe(false);
  });

  it("labels every stored status without alarming copy", () => {
    expect(subscriptionStatusLabel("active")).toBe("Active");
    expect(subscriptionStatusLabel("trialing")).toBe("Trial");
    expect(subscriptionStatusLabel("past_due")).toBe("Payment past due");
    expect(subscriptionStatusLabel("incomplete")).toBe("Checkout incomplete");
    expect(subscriptionStatusLabel("canceled")).toBe("Canceled");
    expect(subscriptionStatusLabel(null)).toBe("No subscription");
    expect(subscriptionStatusLabel("weird")).toBe("Unrecognised status");
  });

  it("labels job statuses and member roles, showing unknown values verbatim", () => {
    expect(jobStatusLabel("draft")).toBe("Draft");
    expect(jobStatusLabel("published")).toBe("Live");
    expect(jobStatusLabel("closed")).toBe("Closed");
    expect(jobStatusLabel("archived")).toBe("archived");
    expect(jobStatusLabel(null)).toBe("Unknown");

    expect(memberRoleLabel("owner")).toBe("Owner");
    expect(memberRoleLabel("recruiter")).toBe("Recruiter");
    expect(memberRoleLabel("viewer")).toBe("Viewer");
    expect(memberRoleLabel("root")).toBe("root");
    expect(memberRoleLabel(null)).toBe("Unknown");
  });
});
