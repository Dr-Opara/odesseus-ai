"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type AdminWalletRow = {
  userId: string;
  email: string | null;
  fullName: string | null;
  walletBalanceCents: number;
  interviewPasses: number;
};

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function AdminWalletsTable({ wallets }: { wallets: AdminWalletRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return wallets;
    return wallets.filter((wallet) =>
      [wallet.fullName, wallet.email].filter(Boolean).some((field) => field!.toLowerCase().includes(q))
    );
  }, [wallets, query]);

  return (
    <>
      <div className="admin-toolbar">
        <input
          className="input"
          placeholder="Search by name or email…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="muted">{filtered.length} of {wallets.length} wallets</span>
      </div>

      <div className="card admin-table">
        <div className="admin-row header" style={{ ["--admin-row-cols" as string]: "1.6fr 1fr 1fr" }}>
          <span>Account</span>
          <span>Wallet balance</span>
          <span>Interview passes</span>
        </div>
        {filtered.map((wallet) => (
          <Link
            href={`/admin/wallets/${wallet.userId}`}
            className="admin-row"
            key={wallet.userId}
            style={{ ["--admin-row-cols" as string]: "1.6fr 1fr 1fr" }}
          >
            <span>
              <strong>{wallet.fullName || "—"}</strong>
              <small>{wallet.email || "no email on file"}</small>
            </span>
            <span>{formatCents(wallet.walletBalanceCents)}</span>
            <span>{wallet.interviewPasses}</span>
          </Link>
        ))}
        {!filtered.length ? <div className="admin-empty">No wallets match this search.</div> : null}
      </div>
    </>
  );
}
