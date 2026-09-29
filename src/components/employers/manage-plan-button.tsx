"use client";

import { useState } from "react";
import { changeEmployerPlan } from "@/lib/employers/billing-adapter";
import EmployerStatePanel from "@/components/employers/state-panel";
import type { EmployerPlanId } from "@/lib/employers/types";

export default function ManagePlanButton({ currentPlanId }: { currentPlanId: EmployerPlanId }) {
  const [status, setStatus] = useState<"idle" | "loading" | "unavailable">("idle");
  const [reason, setReason] = useState("");

  async function handleClick() {
    setStatus("loading");
    const result = await changeEmployerPlan(currentPlanId);
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
        {status === "loading" ? "Loading…" : "Manage Plan"}
      </button>
      {status === "unavailable" ? (
        <div style={{ marginTop: 16 }}>
          <EmployerStatePanel kind="error" title="Plan management isn't available yet" message={reason} onRetry={handleClick} />
        </div>
      ) : null}
    </div>
  );
}
