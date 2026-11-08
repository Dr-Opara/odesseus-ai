"use client";

import { useState } from "react";
import { startAddonCheckoutAction } from "@/lib/employers/actions";
import EmployerStatePanel from "@/components/employers/state-panel";
import { ADDON_JOB_POST } from "@/lib/employer/plans";

/**
 * Buy additional job posts ($10 USD each).
 *
 * Only offered while the AI Starter Bundle is active; the route re-checks that
 * and the webhook re-verifies quantity x $10 before granting anything. Each
 * credit is valid for 30 days from purchase.
 */
export default function BuyAddonsButton({ orgId, canBuy }: { orgId: string; canBuy: boolean }) {
  const [quantity, setQuantity] = useState(1);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (!canBuy) {
    return (
      <p className="muted" style={{ marginTop: 16, fontSize: 14 }}>
        Additional job posts at {ADDON_JOB_POST.priceLabel} USD are available only while your AI Starter Bundle is
        active. Add-on credits you already bought stay valid until their own expiry.
      </p>
    );
  }

  async function start() {
    setPending(true);
    setFailure(null);
    const result = await startAddonCheckoutAction(orgId, quantity);
    setPending(false);
    if (result.status === "unavailable") {
      setFailure(result.reason);
      return;
    }
    window.location.assign(result.data.url);
  }

  return (
    <div style={{ marginTop: 20 }}>
      <h2 style={{ fontSize: 18, margin: "0 0 10px" }}>Additional job posts</h2>
      <div className="emp-page-actions" style={{ alignItems: "center" }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="muted">Quantity</span>
          <input
            className="input"
            type="number"
            min={1}
            max={ADDON_JOB_POST.maxPerPurchase}
            value={quantity}
            onChange={(event) =>
              setQuantity(
                Math.min(ADDON_JOB_POST.maxPerPurchase, Math.max(1, Math.floor(Number(event.target.value) || 1)))
              )
            }
            style={{ width: 90 }}
          />
        </label>
        <button type="button" className="figma-btn figma-btn-orange" disabled={pending} onClick={start}>
          {pending
            ? "Opening checkout…"
            : `Buy ${quantity} · $${quantity * ADDON_JOB_POST.priceUsd} USD`}
        </button>
      </div>
      <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
        {ADDON_JOB_POST.priceLabel} USD each. Each credit expires {ADDON_JOB_POST.validDays} days after purchase,
        independent of your billing cycle.
      </p>
      {failure ? (
        <div style={{ marginTop: 16 }}>
          <EmployerStatePanel kind="error" title="Could not start checkout" message={failure} />
        </div>
      ) : null}
    </div>
  );
}
