export const billingCatalog = {
  wallet_10: { label: "$10 Odesseus wallet", description: "Prepaid balance for Apply and Smart Apply", amountCents: 1000, creditType: "application" as const, creditDelta: 1 },
  wallet_20: { label: "$20 Odesseus wallet", description: "Prepaid balance for Apply and Smart Apply", amountCents: 2000, creditType: "application" as const, creditDelta: 1 },
  wallet_50: { label: "$50 Odesseus wallet", description: "Prepaid balance for Apply and Smart Apply", amountCents: 5000, creditType: "application" as const, creditDelta: 1 },
  interview_1: { label: "1 live interview pass", description: "One Odesseus Live interview session", amountCents: 1499, creditType: "interview" as const, creditDelta: 1 },
  interview_monthly: { label: "Odesseus Live Monthly", description: "Personal Odesseus Live access for one month, subject to fair use", amountCents: 1999, creditType: "interview" as const, creditDelta: 1 },
  interview_personal_annual: { label: "Odesseus Live Personal Annual", description: "Personal Odesseus Live access for 12 months, subject to fair use", amountCents: 9900, creditType: "interview" as const, creditDelta: 1 },
  interview_share_annual: { label: "Odesseus Live Share Annual", description: "Annual Odesseus Live access with up to 10 unique activated guests", amountCents: 49900, creditType: "interview" as const, creditDelta: 1 },
} as const;

export type BillingSku = keyof typeof billingCatalog;
