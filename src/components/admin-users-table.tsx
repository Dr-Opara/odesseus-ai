"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type AdminUserRow = {
  id: string;
  email: string | null;
  createdAt: string;
  bannedUntil: string | null;
  fullName: string | null;
  onboardingCompleted: boolean;
  walletBalanceCents: number;
  employerRole: string | null;
  employerOrgName: string | null;
};

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function isSuspended(bannedUntil: string | null) {
  return Boolean(bannedUntil && new Date(bannedUntil) > new Date());
}

export default function AdminUsersTable({ users }: { users: AdminUserRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((user) =>
      [user.fullName, user.email, user.employerOrgName]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q))
    );
  }, [users, query]);

  return (
    <>
      <div className="admin-toolbar">
        <input
          className="input"
          placeholder="Search by name, email, or organization…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="muted">{filtered.length} of {users.length} accounts</span>
      </div>

      <div className="card admin-table">
        <div className="admin-row header" style={{ ["--admin-row-cols" as string]: "1.6fr 1fr 1fr .8fr .8fr" }}>
          <span>Account</span>
          <span>Role</span>
          <span>Wallet</span>
          <span>Joined</span>
          <span>State</span>
        </div>
        {filtered.map((user) => (
          <Link
            href={`/admin/users/${user.id}`}
            className="admin-row"
            key={user.id}
            style={{ ["--admin-row-cols" as string]: "1.6fr 1fr 1fr .8fr .8fr" }}
          >
            <span>
              <strong>{user.fullName || "—"}</strong>
              <small>{user.email || "no email on file"}</small>
            </span>
            <span>{user.employerOrgName ? `${user.employerRole} · ${user.employerOrgName}` : "Candidate"}</span>
            <span>{formatCents(user.walletBalanceCents)}</span>
            <span>{new Date(user.createdAt).toLocaleDateString()}</span>
            <span className={isSuspended(user.bannedUntil) ? "readiness-status bad" : "readiness-status good"}>
              {isSuspended(user.bannedUntil) ? "Suspended" : "Active"}
            </span>
          </Link>
        ))}
        {!filtered.length ? <div className="admin-empty">No accounts match this search.</div> : null}
      </div>
    </>
  );
}
