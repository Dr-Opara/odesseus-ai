"use client";

import { useState } from "react";
import { startSeatCheckout } from "@/lib/employers/billing-adapter";
import EmployerStatePanel from "@/components/employers/state-panel";
import { RECRUITER_SEAT_PRICE_LABEL, RECRUITER_SEAT_UNIT } from "@/lib/pricing/candidate-pricing";

/**
 * F13-M: the frontend never creates membership or grants a seat. Buying a seat
 * starts a Stripe subscription checkout, and capacity only changes once the
 * billing webhook confirms the paid invoice.
 */
export default function AddSeatButton({ orgId }: { orgId: string }) {
  const [quantity, setQuantity] = useState(1);
  const [status, setStatus] = useState<"idle" | "loading" | "failed">("idle");
  const [reason, setReason] = useState("");

  async function handleClick() {
    setStatus("loading");
    setReason("");
    const result = await startSeatCheckout(orgId, quantity);
    setStatus("idle");
    if (result.status === "unavailable") {
      setReason(result.reason);
      return;
    }
    window.location.assign(result.data.checkoutUrl);
  }

  return (
    <div style={{ marginTop: 28 }}>
      <div className="emp-row" style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <span className="emp-row-value">
          Add recruiter seats at {RECRUITER_SEAT_PRICE_LABEL}
          {RECRUITER_SEAT_UNIT.replace("per additional seat", "").trim()}
        </span>
        <input
          className="input"
          type="number"
          min={1}
          max={20}
          value={quantity}
          onChange={(event) => setQuantity(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
          style={{ maxWidth: 100 }}
          aria-label="Number of seats"
        />
        <button className="emp-btn-secondary" type="button" onClick={handleClick} disabled={status === "loading"}>
          {status === "loading" ? "Starting…" : "Add Seats"}
        </button>
      </div>

      {reason ? (
        <div style={{ marginTop: 16 }}>
          <EmployerStatePanel kind="error" title="We couldn't start that checkout" message={reason} />
        </div>
      ) : null}
    </div>
  );
}
