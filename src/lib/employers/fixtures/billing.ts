import type { EmployerBillingSummary } from "../types";

/** DEV/TEST-ONLY FIXTURE — see gate in `../billing-adapter.ts`. */
export const EMPLOYER_BILLING_FIXTURE: EmployerBillingSummary = {
  planId: "Starter",
  priceLabel: "$79/mo",
  subscriptionStatus: "active",
  periodStart: "2026-09-15T00:00:00.000Z",
  periodEnd: "2026-10-15T00:00:00.000Z",
  capacity: { included: 3, published: 2, remaining: 1 },
  seats: { required: 3, active: 2, activeUntil: null },
  featuredActive: 1,
};
