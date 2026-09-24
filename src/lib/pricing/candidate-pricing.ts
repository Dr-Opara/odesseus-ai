/**
 * Display-only candidate pricing constants for the new wallet/pay-per-apply
 * contract (frontend/pricing-wallet-ui phase). This is presentation data for
 * UI copy — it is NOT the billing engine. The Stripe/checkout catalog that
 * actually charges cards (`src/lib/billing/catalog.ts`) is owned by the
 * backend/pricing-wallet workstream and is intentionally left untouched here;
 * it will be replaced when OpenCode's wallet ledger migration ships.
 */

export type ApplyTier = "standard" | "smart";

export const APPLY_TIERS: Record<
  ApplyTier,
  { label: string; priceCents: number; priceLabel: string; description: string }
> = {
  standard: {
    label: "Standard Apply",
    priceCents: 49,
    priceLabel: "$0.49",
    description:
      "Odesseus tailors your resume and submits the application. Charged only after a verified successful submission.",
  },
  smart: {
    label: "Smart Apply",
    priceCents: 199,
    priceLabel: "$1.99",
    description:
      "Everything in Standard Apply, plus deeper role-specific tailoring and a closer pass on hard requirements before submission.",
  },
};

export const WALLET_TOPUP_AMOUNTS_CENTS = [1000, 2000, 5000] as const;
export type WalletTopUpAmountCents = (typeof WALLET_TOPUP_AMOUNTS_CENTS)[number];

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export const PREP_AGENT_PRICE_LABEL = "Free";

export const EMPLOYER_PLANS = [
  { name: "Starter", priceLabel: "$79", unit: "/mo", jobs: "3 active jobs" },
  { name: "Growth", priceLabel: "$149", unit: "/mo", jobs: "10 active jobs" },
  { name: "Business", priceLabel: "$299", unit: "/mo", jobs: "25 active jobs" },
] as const;

export const PROMOTION_PLANS = [
  { name: "Featured", priceLabel: "$29", unit: "/ 7 days" },
  { name: "Featured", priceLabel: "$49", unit: "/ 14 days" },
  { name: "AI Featured", priceLabel: "$129", unit: "/ 30 days" },
] as const;

export const RECRUITER_SEAT_PRICE_LABEL = "$20";
export const RECRUITER_SEAT_UNIT = "/month per additional seat";

export const LIVE_PLANS = [
  { name: "Single session", priceLabel: "$24.99", unit: "/ session" },
  { name: "3 passes", priceLabel: "$59.99", unit: "" },
  { name: "Annual", priceLabel: "$499", unit: "/ year" },
] as const;
