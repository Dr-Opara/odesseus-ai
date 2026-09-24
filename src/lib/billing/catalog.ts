export const billingCatalog = {
  wallet_10: { label: "$10 Odesseus wallet", description: "Prepaid balance for Apply and Smart Apply", amountCents: 1000, creditType: "application" as const, creditDelta: 1 },
  wallet_20: { label: "$20 Odesseus wallet", description: "Prepaid balance for Apply and Smart Apply", amountCents: 2000, creditType: "application" as const, creditDelta: 1 },
  wallet_50: { label: "$50 Odesseus wallet", description: "Prepaid balance for Apply and Smart Apply", amountCents: 5000, creditType: "application" as const, creditDelta: 1 },
  interview_1: { label: "1 live interview pass", description: "One Odesseus Live interview session", amountCents: 2499, creditType: "interview" as const, creditDelta: 1 },
  interview_3: { label: "3 live interview passes", description: "Three Odesseus Live interview sessions", amountCents: 5999, creditType: "interview" as const, creditDelta: 3 },
  interview_annual: { label: "Odesseus Live Annual", description: "Odesseus Live access for 12 months, subject to fair use", amountCents: 49900, creditType: "interview" as const, creditDelta: 1 },
} as const;

export type BillingSku = keyof typeof billingCatalog;
