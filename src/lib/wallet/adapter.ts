/**
 * INTEGRATION POINT — OpenCode wallet API (backend/pricing-wallet).
 *
 * This adapter is the single seam the candidate Wallet UI talks through. The
 * real wallet ledger, top-up charging, and per-apply debits are backend
 * business logic owned by the backend/pricing-wallet workstream and do not
 * exist yet on this branch. Every function below is a typed stub: it returns
 * an explicit "unavailable" result rather than a fabricated balance or a
 * fake successful charge, so the UI can render an honest not-yet-available
 * state instead of lying to the user about their money.
 *
 * To wire this up once the backend ships: replace each function body with a
 * real fetch/server action call against OpenCode's wallet endpoints, keeping
 * the exported types so the UI components do not need to change.
 */

export type WalletBalance = {
  balanceCents: number;
  updatedAt: string;
};

export type WalletTransaction = {
  id: string;
  kind: "topup" | "apply_charge" | "refund";
  amountCents: number;
  label: string;
  createdAt: string;
};

export type WalletResult<T> =
  | { status: "ok"; data: T }
  | { status: "unavailable"; reason: string };

/** INTEGRATION POINT: replace with a real fetch to OpenCode's wallet balance endpoint. */
export async function getWalletBalance(): Promise<WalletResult<WalletBalance>> {
  return { status: "unavailable", reason: "Wallet balance API is not yet available." };
}

/** INTEGRATION POINT: replace with a real fetch to OpenCode's wallet transaction history endpoint. */
export async function listWalletTransactions(): Promise<WalletResult<WalletTransaction[]>> {
  return { status: "unavailable", reason: "Wallet transaction history API is not yet available." };
}

/**
 * INTEGRATION POINT: replace with a real call that starts a Stripe (or
 * equivalent) checkout/payment-intent flow for a wallet top-up, owned by
 * OpenCode. Must never be implemented here as a client-side "pretend charge".
 */
export async function requestWalletTopUp(
  amountCents: number
): Promise<WalletResult<{ checkoutUrl: string }>> {
  return {
    status: "unavailable",
    reason: `Wallet top-up (${amountCents} cents) is not yet available.`,
  };
}
