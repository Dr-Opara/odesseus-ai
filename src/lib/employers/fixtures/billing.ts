import { EMPLOYER_PLANS } from "@/lib/pricing/candidate-pricing";
import type { EmployerBillingSummary } from "../types";

/** DEV/TEST-ONLY FIXTURE — see gate in `../billing-adapter.ts`. */
export const EMPLOYER_BILLING_FIXTURE: EmployerBillingSummary = {
  planId: "Starter",
  priceLabel: `${EMPLOYER_PLANS[0].priceLabel}${EMPLOYER_PLANS[0].unit}`,
  renewalDate: "2026-10-15T00:00:00.000Z",
  paymentStatus: "current",
  seatsUsed: 2,
  seatLimit: 3,
};
