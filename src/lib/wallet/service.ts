/**
 * Candidate wallet read services (Phase 1 of the wallet contract).
 *
 * The wallet is server-authoritative: eligibility to start Apply is decided by
 * wallet_balance_cents (never the legacy application_credits column), and the
 * only mutation paths are the server-side finalization/reversal RPCs and the
 * Stripe fulfillment trigger. These services are read helpers for the wallet
 * API routes and desktop/mobile surfaces; callers resolve the user exactly
 * once from the auth session, never from client input.
 *
 * Balance mutations are intentionally absent here — there is no "add funds"
 * or "set balance" helper a browser could reach.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { applyRates } from "@/lib/billing/catalog";

export type WalletClient = SupabaseClient<Database>;

/** Wallet money-movement ledger types (top-ups credit, Apply debits). */
export const WALLET_TRANSACTION_TYPES = [
  "wallet_topup",
  "standard_apply",
  "smart_apply",
] as const;

export type WalletBalance = {
  wallet_balance_cents: number;
  standard_apply_affordable: boolean;
  smart_apply_affordable: boolean;
  standard_apply_rate_cents: number;
  smart_apply_rate_cents: number;
};

export type WalletTransaction = {
  id: string;
  credit_type: string;
  delta: number;
  reason: string;
  amount_cents: number | null;
  balance_cents_after: number | null;
  external_reference: string | null;
  created_at: string;
  metadata: unknown;
};

export type WalletLedgerPage = {
  items: WalletTransaction[];
  total: number;
  limit: number;
  offset: number;
};

/** The candidate's current wallet balance plus what it can afford today. */
export async function getWalletBalance(
  client: WalletClient,
  userId: string
): Promise<WalletBalance> {
  const { data, error } = await client
    .from("credit_balances")
    .select("wallet_balance_cents")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load wallet balance: ${error.message}`);
  }
  const balance = data?.wallet_balance_cents ?? 0;

  return {
    wallet_balance_cents: balance,
    standard_apply_affordable: balance >= applyRates.standard.amountCents,
    smart_apply_affordable: balance >= applyRates.smart.amountCents,
    standard_apply_rate_cents: applyRates.standard.amountCents,
    smart_apply_rate_cents: applyRates.smart.amountCents,
  };
}

/**
 * Paginated wallet ledger (money movements only: top-ups and Apply debits).
 * Newest first, capped at 100 rows per page. Uses an exact count so the UI
 * can render "page X of Y" without trusting a client-computed total.
 */
export async function getWalletTransactions(
  client: WalletClient,
  userId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<WalletLedgerPage> {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  const { data, error, count } = await client
    .from("credit_transactions")
    .select(
      "id,credit_type,delta,reason,amount_cents,balance_cents_after,external_reference,created_at,metadata",
      { count: "exact" }
    )
    .eq("user_id", userId)
    .in("credit_type", WALLET_TRANSACTION_TYPES)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Could not load wallet transactions: ${error.message}`);
  }

  return {
    items: (data as WalletTransaction[]) ?? [],
    total: count ?? 0,
    limit,
    offset,
  };
}