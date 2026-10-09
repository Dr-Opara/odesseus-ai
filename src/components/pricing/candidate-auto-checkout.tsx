"use client";

import { useEffect, useRef } from "react";
import { createCheckoutSession } from "@/app/actions/billing";
import type { BillingSku } from "@/lib/billing/catalog";

export default function CandidateAutoCheckout({ sku }: { sku: BillingSku }) {
  const formRef = useRef<HTMLFormElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    formRef.current?.requestSubmit();
  }, []);

  return (
    <form ref={formRef} action={createCheckoutSession.bind(null, sku)}>
      <button type="submit" style={{ display: "none" }} aria-hidden="true">
        Continue to checkout
      </button>
      <p className="muted" style={{ margin: "0 0 18px" }}>
        Opening secure checkout…
      </p>
    </form>
  );
}
