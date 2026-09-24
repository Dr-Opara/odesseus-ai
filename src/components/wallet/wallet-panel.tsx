"use client";

import { useEffect, useState } from "react";
import {
  getWalletBalance,
  listWalletTransactions,
  requestWalletTopUp,
  type WalletBalance,
  type WalletTransaction,
} from "@/lib/wallet/adapter";
import { WALLET_TOPUP_AMOUNTS_CENTS, formatCents } from "@/lib/pricing/candidate-pricing";

/**
 * Candidate Wallet UI. Talks only through `src/lib/wallet/adapter.ts` — see
 * that file for the OpenCode integration point. Until the real wallet API
 * ships, this renders an honest "not yet available" state rather than a
 * fabricated balance or a fake successful top-up.
 */
export default function WalletPanel() {
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [topUpNotice, setTopUpNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [balanceResult, transactionsResult] = await Promise.all([
        getWalletBalance(),
        listWalletTransactions(),
      ]);
      if (cancelled) return;

      if (balanceResult.status === "ok") {
        setBalance(balanceResult.data);
      } else {
        setUnavailableReason(balanceResult.reason);
      }
      if (transactionsResult.status === "ok") {
        setTransactions(transactionsResult.data);
      }
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function topUp(amountCents: number) {
    setTopUpNotice(null);
    const result = await requestWalletTopUp(amountCents);
    if (result.status === "ok") {
      window.location.assign(result.data.checkoutUrl);
      return;
    }
    setTopUpNotice(result.reason);
  }

  return (
    <div className="wallet-panel">
      <div className="card wallet-balance-card">
        <div className="muted" style={{ fontSize: 13 }}>Wallet balance</div>
        {loading ? (
          <strong className="wallet-balance-amount">—</strong>
        ) : balance ? (
          <strong className="wallet-balance-amount">{formatCents(balance.balanceCents)}</strong>
        ) : (
          <>
            <strong className="wallet-balance-amount">—</strong>
            <span className="muted wallet-unavailable-note">
              {unavailableReason || "Wallet balance is not yet available."}
            </span>
          </>
        )}
      </div>

      <div className="wallet-topup-grid">
        {WALLET_TOPUP_AMOUNTS_CENTS.map((amountCents) => (
          <button
            key={amountCents}
            type="button"
            className="btn btn-secondary wallet-topup-btn"
            onClick={() => topUp(amountCents)}
          >
            Add {formatCents(amountCents)}
          </button>
        ))}
      </div>
      {topUpNotice ? <p className="muted wallet-unavailable-note">{topUpNotice}</p> : null}

      <section style={{ marginTop: 28 }}>
        <div className="muted" style={{ fontSize: 13 }}>Recent wallet activity</div>
        <div className="card" style={{ marginTop: 10 }}>
          {transactions.length ? (
            transactions.map((transaction, index) => (
              <div
                className="billing-history-row"
                key={transaction.id}
                style={{ borderTop: index ? "1px solid var(--line)" : "none" }}
              >
                <div>
                  <strong>{transaction.label}</strong>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                    {new Date(transaction.createdAt).toLocaleString()}
                  </div>
                </div>
                <strong>
                  {transaction.kind === "apply_charge" ? "-" : "+"}
                  {formatCents(transaction.amountCents)}
                </strong>
              </div>
            ))
          ) : (
            <div className="muted" style={{ padding: 26 }}>
              Wallet activity will appear here once wallet top-ups are available.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
