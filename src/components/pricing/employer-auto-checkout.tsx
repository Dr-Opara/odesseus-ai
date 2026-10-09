"use client";

import { useEffect, useRef, useState } from "react";
import {
  startPlanCheckoutAction,
  startSeatCheckoutAction,
} from "@/lib/employers/actions";
import type { EmployerPlanId } from "@/lib/employers/types";

export default function EmployerAutoCheckout({
  orgId,
  kind,
  planId,
}: {
  orgId: string;
  kind: "plan" | "seat";
  planId?: EmployerPlanId;
}) {
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      const result =
        kind === "seat"
          ? await startSeatCheckoutAction(orgId, 1)
          : planId
            ? await startPlanCheckoutAction(orgId, planId)
            : { status: "unavailable" as const, reason: "Choose a valid plan." };

      if (result.status === "unavailable") {
        setError(result.reason);
        return;
      }

      window.location.assign(result.data.url);
    })();
  }, [kind, orgId, planId]);

  return (
    <div style={{ marginTop: 18 }}>
      {error ? (
        <div className="review-note">{error}</div>
      ) : (
        <p className="muted">Opening secure checkout…</p>
      )}
    </div>
  );
}
