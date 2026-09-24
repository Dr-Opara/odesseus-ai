// Candidate billing surface for the current pricing contract.
//
// Apply submissions are wallet debits at a per-mode rate — Standard Apply
// 49¢ and Smart Apply 199¢ per verified successful submission — never a
// checkout SKU. Candidates preload a monetary wallet through the wallet_*
// top-up SKUs below; the debit is applied server-side by the atomic
// finalization RPC only after the submission is verified as successful.
//
// Employer products (plans, featured listings, recruiter seats) are sold
// through Stripe subscriptions in a later milestone and deliberately do not
// appear in this one-time checkout catalog yet. Odesseus Live SKUs are
// unchanged from the legacy catalog.

export const applyRates = {
  standard: {
    label: "Standard Apply",
    description: "One verified successful submission across supported job boards and employer career sites",
    amountCents: 49,
    creditType: "standard_apply" as const,
  },
  smart: {
    label: "Smart Apply",
    description: "One verified successful submission with deeper automation for multi-page applications",
    amountCents: 199,
    creditType: "smart_apply" as const,
  },
} as const;

export type ApplyMode = keyof typeof applyRates;

export type BillingSku = keyof typeof billingCatalog;

export const billingCatalog = {
  wallet_10: { label: "Wallet top-up — $10", description: "Add $10 to your wallet for Standard and Smart Apply submissions", amountCents: 1000, creditType: "wallet_topup" as const, creditDelta: 1000 },
  wallet_20: { label: "Wallet top-up — $20", description: "Add $20 to your wallet for Standard and Smart Apply submissions", amountCents: 2000, creditType: "wallet_topup" as const, creditDelta: 2000 },
  wallet_50: { label: "Wallet top-up — $50", description: "Add $50 to your wallet for Standard and Smart Apply submissions", amountCents: 5000, creditType: "wallet_topup" as const, creditDelta: 5000 },
  interview_1: { label: "1 live interview pass", description: "One Odesseus Live interview session", amountCents: 2499, creditType: "interview" as const, creditDelta: 1 },
  interview_3: { label: "3 live interview passes", description: "Three Odesseus Live interview sessions", amountCents: 5999, creditType: "interview" as const, creditDelta: 3 },
  // Time-boxed entitlement, not a discrete-pass grant: fulfillment (see the
  // add_live_annual_entitlement migration) sets credit_balances.live_unlimited_until
  // instead of applying creditDelta to interview_passes. creditDelta stays a
  // positive placeholder only to satisfy billing_events_credit_delta_check.
  interview_annual: { label: "Odesseus Live Annual", description: "Odesseus Live access for 12 months, subject to fair use", amountCents: 49900, creditType: "interview" as const, creditDelta: 1 },
} as const;