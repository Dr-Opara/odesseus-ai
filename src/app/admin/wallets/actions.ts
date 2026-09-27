"use server";

import { requireAdmin } from "@/lib/admin/auth";

/**
 * INTEGRATION POINT — backend/pricing-wallet ledger-write API.
 *
 * `credit_transactions.credit_type` is constrained at the database level to
 * `application` | `interview` (see supabase/migrations/20260918180133_baseline_v0_11.sql),
 * and `credit_balances.wallet_balance_cents` is written by a ledger mechanism
 * that does not live in this repo's migrations — it belongs to the
 * backend/pricing-wallet workstream. There is no verified, safe write path
 * for an admin-initiated wallet adjustment yet, so this action reports an
 * honest "not yet available" result instead of guessing at a credit_type or
 * writing directly to wallet_balance_cents and risking a desync with
 * whatever ledger trigger the backend team ships.
 *
 * To wire this up once the backend ships: replace the body with a call into
 * the real ledger-write RPC/endpoint, keeping the same return shape so
 * src/app/admin/wallets/[id]/page.tsx does not need to change.
 */
export async function adjustWalletBalance(
  _prevState: { ok: boolean; message: string } | undefined,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();

  const userId = String(formData.get("user_id") || "").trim();
  const amount = String(formData.get("amount") || "").trim();
  const reason = String(formData.get("reason") || "").trim();

  if (!userId || !amount || !reason) {
    return { ok: false, message: "Amount and reason are required." };
  }

  return {
    ok: false,
    message:
      "Wallet adjustments are not yet available. The wallet ledger write path is owned by the backend/pricing-wallet workstream and has not shipped to this environment.",
  };
}
