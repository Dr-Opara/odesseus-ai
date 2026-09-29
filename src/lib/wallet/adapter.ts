/**
 * Candidate wallet adapter — the real backend read.
 *
 * This was a typed stub: the wallet ledger, top-up charging, and per-apply
 * debits were "owned by a workstream that had not shipped", so every function
 * returned `unavailable`. The wallet backend exists
 * (`src/lib/wallet/service.ts`, exposed through `/api/wallet*`), so the reads
 * are wired.
 *
 * What deliberately did not change:
 *
 *  - **A top-up is still not implemented here.** It is a Stripe checkout
 *    started by `createCheckoutSession` (see `src/app/actions/billing.ts`),
 *    and the webhook is what credits the wallet. This adapter must never
 *    implement a "pretend charge" — a client-side balance write would let a
 *    browser grant itself Apply money.
 *  - **No balance is ever defaulted.** A read that fails returns
 *    `unavailable`, which the panel renders as an error. Zero is a real
 *    balance, and confusing the two would tell a candidate with money in their
 *    account that they have none.
 *
 * The display types here differ from the backend's rows: the wallet stores a
 * signed `delta` per ledger entry plus a `credit_type`, while the panel shows
 * a kind and a human label. That mapping is presentation, done once below.
 */

import { createClient } from "@/lib/supabase/server";
import {
  getWalletBalance as readBackendBalance,
  getWalletTransactions as readBackendTransactions,
  type WalletTransaction as BackendTransaction,
} from "@/lib/wallet/service";

export type WalletBalance = {
  balanceCents: number;
  updatedAt: string;
  /** What the candidate can start right now, per the backend's own rates. */
  standardApplyAffordable: boolean;
  smartApplyAffordable: boolean;
  standardApplyRateCents: number;
  smartApplyRateCents: number;
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

/** The signed-in candidate, or `null` when there is no session. */
async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  return auth?.claims?.sub ?? null;
}

/** True when Next is telling us this route is dynamic. See `./employers/context`. */
function isDynamicUsageSignal(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("DYNAMIC_SERVER_USAGE");
}

/**
 * Maps a stored ledger entry onto the panel's transaction shape.
 *
 * `credit_type` is the backend's own vocabulary (`wallet_topup`,
 * `standard_apply`, `smart_apply`, `interview`). A positive delta is money in
 * and a negative delta is money out, so the kind is derived from the sign
 * rather than guessed per type — an unknown type still renders with the right
 * direction and its real amount.
 */
function toTransaction(row: BackendTransaction): WalletTransaction {
  const isCredit = row.delta > 0;
  const type = row.credit_type;
  const kind: WalletTransaction["kind"] = isCredit
    ? type === "interview" || type === "application_credit"
      ? "refund"
      : "topup"
    : "apply_charge";

  return {
    id: row.id,
    kind,
    amountCents: Math.abs(row.amount_cents ?? row.delta),
    label: describeEntry(row),
    createdAt: row.created_at,
  };
}

/** Human copy for one ledger entry, from the backend's own reason where it has one. */
function describeEntry(row: BackendTransaction): string {
  if (row.reason && row.reason.trim()) return row.reason;

  const labels: Record<string, string> = {
    wallet_topup: "Wallet top-up",
    standard_apply: "Standard Apply",
    smart_apply: "Smart Apply",
    interview: "Interview pass",
  };
  return labels[row.credit_type] ?? "Wallet activity";
}

/** The candidate's spendable balance and what it currently affords. */
export async function getWalletBalance(): Promise<WalletResult<WalletBalance>> {
  try {
    const userId = await currentUserId();
    if (!userId) {
      return { status: "unavailable", reason: "Please sign in to see your wallet." };
    }

    const supabase = await createClient();
    const balance = await readBackendBalance(supabase, userId);

    return {
      status: "ok",
      data: {
        balanceCents: balance.wallet_balance_cents,
        updatedAt: new Date().toISOString(),
        standardApplyAffordable: balance.standard_apply_affordable,
        smartApplyAffordable: balance.smart_apply_affordable,
        standardApplyRateCents: balance.standard_apply_rate_cents,
        smartApplyRateCents: balance.smart_apply_rate_cents,
      },
    };
  } catch (error) {
    if (isDynamicUsageSignal(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_WALLET] balance read failed", message);
    return { status: "unavailable", reason: "Could not load your wallet balance." };
  }
}

/**
 * The paginated wallet ledger.
 *
 * Only the first page is returned: the panel is a recent-activity list, and
 * paginating it in a server component would need a client round trip for no
 * product benefit. The backend's own limit and offset are used unchanged, so
 * the query it sees is the one it would have answered directly.
 */
export async function listWalletTransactions(
  options?: { limit?: number; offset?: number }
): Promise<WalletResult<WalletTransaction[]>> {
  try {
    const userId = await currentUserId();
    if (!userId) {
      return { status: "unavailable", reason: "Please sign in to see your wallet." };
    }

    const supabase = await createClient();
    const page = await readBackendTransactions(supabase, userId, {
      limit: options?.limit ?? 20,
      offset: options?.offset ?? 0,
    });

    return { status: "ok", data: page.items.map(toTransaction) };
  } catch (error) {
    if (isDynamicUsageSignal(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_WALLET] ledger read failed", message);
    return { status: "unavailable", reason: "Could not load your wallet activity." };
  }
}

/**
 * Starting a wallet top-up is a paid purchase, not a local state change.
 *
 * It is deliberately not implemented here. The top-ups are Stripe checkout
 * SKUs (`wallet_10`, `wallet_20`, `wallet_50` in `src/lib/billing/catalog.ts`)
 * started by the server action `createCheckoutSession`, and the billing webhook
 * is what writes the credit transaction and updates the balance.
 *
 * Implementing this as anything other than "open a checkout" would mean a
 * client-side balance write, which is exactly the wallet self-grant the
 * security rules forbid. It stays unavailable rather than growing a fake
 * success.
 */
export async function requestWalletTopUp(
  amountCents: number
): Promise<WalletResult<{ checkoutUrl: string }>> {
  return {
    status: "unavailable",
    reason: `Wallet top-up (${amountCents} cents) is not yet available.`,
  };
}
