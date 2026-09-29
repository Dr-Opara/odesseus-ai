"use client";

import { useState } from "react";
import { startSeatCheckoutAction } from "@/lib/employers/actions";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EXTRA_RECRUITER_SEAT_PRICE_LABEL, EXTRA_RECRUITER_SEAT_UNIT } from "@/lib/employer/plans";

/**
 * Recruiter seat purchase (F13-M).
 *
 * A seat is a paid line item, so this opens the org's seat checkout and grants
 * nothing. The webhook confirms payment and syncs `recruiter_seats`; until that
 * happens the seat count on the page is unchanged, and this component never
 * reports a seat as bought. It also never creates membership client-side —
 * inviting a person is a separate, admin-gated action.
 */
export default function AddSeatButton({ orgId }: { orgId: string }) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function startCheckout() {
    setPending(true);
    setFailure(null);
    const result = await startSeatCheckoutAction(orgId, 1);
    setPending(false);

    if (result.status === "unavailable") {
      setFailure(result.reason);
      return;
    }
    window.location.assign(result.data.url);
  }

  return (
    <div style={{ marginTop: 20 }}>
      <button
        className="figma-btn figma-btn-orange"
        type="button"
        onClick={startCheckout}
        disabled={pending}
      >
        {pending ? "Opening checkout…" : "Add Recruiter Seat"}
      </button>
      <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
        {EXTRA_RECRUITER_SEAT_PRICE_LABEL} {EXTRA_RECRUITER_SEAT_UNIT}. The seat is added once
        payment is confirmed.
      </p>
      {failure ? (
        <div style={{ marginTop: 16 }}>
          <EmployerStatePanel
            kind="error"
            title="Could not start seat checkout"
            message={failure}
            onRetry={startCheckout}
          />
        </div>
      ) : null}
    </div>
  );
}
