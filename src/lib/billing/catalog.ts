export const billingCatalog = {
  app_1: { label: "1 application credit", description: "One successful AI-submitted application across supported job boards and employer career sites", amountCents: 99, creditType: "application" as const, creditDelta: 1 },
  app_25: { label: "25 application credits", description: "25 successful AI-submitted applications", amountCents: 2000, creditType: "application" as const, creditDelta: 25 },
  app_50: { label: "50 application credits", description: "50 successful AI-submitted applications", amountCents: 3500, creditType: "application" as const, creditDelta: 50 },
  app_100: { label: "100 application credits", description: "100 successful AI-submitted applications", amountCents: 5900, creditType: "application" as const, creditDelta: 100 },
  interview_1: { label: "1 live interview pass", description: "One Odysseus Live interview session", amountCents: 2499, creditType: "interview" as const, creditDelta: 1 },
  interview_3: { label: "3 live interview passes", description: "Three Odysseus Live interview sessions", amountCents: 5999, creditType: "interview" as const, creditDelta: 3 },
  // Time-boxed entitlement, not a discrete-pass grant: fulfillment (see the
  // add_live_annual_entitlement migration) sets credit_balances.live_unlimited_until
  // instead of applying creditDelta to interview_passes. creditDelta stays a
  // positive placeholder only to satisfy billing_events_credit_delta_check.
  interview_annual: { label: "Odysseus Live Annual", description: "Odysseus Live access for 12 months, subject to fair use", amountCents: 49900, creditType: "interview" as const, creditDelta: 1 },
} as const;

export type BillingSku = keyof typeof billingCatalog;
