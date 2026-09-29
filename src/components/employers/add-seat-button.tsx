"use client";

import { useState } from "react";
import { purchaseRecruiterSeat } from "@/lib/employers/billing-adapter";
import EmployerStatePanel from "@/components/employers/state-panel";

/** F13-M: frontend never creates membership/provisioning logic client-side — this only ever reports what the backend actually confirmed. */
export default function AddSeatButton() {
  const [status, setStatus] = useState<"idle" | "loading" | "unavailable">("idle");
  const [reason, setReason] = useState("");

  async function handleClick() {
    setStatus("loading");
    const result = await purchaseRecruiterSeat();
    if (result.status === "unavailable") {
      setReason(result.reason);
      setStatus("unavailable");
    } else {
      setStatus("idle");
    }
  }

  return (
    <div style={{ marginTop: 20 }}>
      <button className="figma-btn figma-btn-orange" type="button" onClick={handleClick} disabled={status === "loading"}>
        {status === "loading" ? "Processing…" : "Add Recruiter Seat"}
      </button>
      {status === "unavailable" ? (
        <div style={{ marginTop: 16 }}>
          <EmployerStatePanel kind="error" title="Adding a seat isn't available yet" message={reason} onRetry={handleClick} />
        </div>
      ) : null}
    </div>
  );
}
