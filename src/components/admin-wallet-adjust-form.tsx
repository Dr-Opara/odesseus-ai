"use client";

import { useActionState } from "react";
import { adjustWalletBalance } from "@/app/admin/wallets/actions";

export default function AdminWalletAdjustForm({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState(adjustWalletBalance, undefined);

  return (
    <form action={formAction} className="admin-inline-form" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
      <input type="hidden" name="user_id" value={userId} />
      <input className="input" name="amount" placeholder="Amount (e.g. 5.00 or -5.00)" required />
      <input className="input" name="reason" placeholder="Adjustment reason (required for audit trail)" required />
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Submitting…" : "Apply adjustment"}
      </button>
      {state ? (
        <p className={state.ok ? "muted" : "wallet-unavailable-note"}>{state.message}</p>
      ) : null}
    </form>
  );
}
