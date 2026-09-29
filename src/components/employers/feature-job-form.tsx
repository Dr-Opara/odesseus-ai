"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { purchaseFeaturedJob, type FeaturedJobPackage } from "@/lib/employers/featured-adapter";
import EmployerStatePanel from "@/components/employers/state-panel";
import type { FeaturedJobPackageId } from "@/lib/employers/types";

/**
 * Featured job package selection + purchase (F13-O). Packages are the locked
 * $29 / 7 days, $49 / 14 days, and $129 / 30 days AI Featured options.
 * Purchasing only starts a Stripe checkout: a job is never marked featured
 * here, and the boost appears once the backend confirms payment.
 */
export default function FeatureJobForm({
  orgId,
  jobId,
  jobTitle,
  packages,
  alreadyFeatured,
}: {
  orgId: string;
  jobId: string;
  jobTitle: string;
  packages: FeaturedJobPackage[];
  alreadyFeatured: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<FeaturedJobPackageId>(packages[0]?.id);
  const [status, setStatus] = useState<"idle" | "submitting" | "failed">("idle");
  const [reason, setReason] = useState("");

  async function handleCheckout() {
    setStatus("submitting");
    setReason("");
    const result = await purchaseFeaturedJob(orgId, jobId, selected);
    if (result.status === "unavailable") {
      setReason(result.reason);
      setStatus("failed");
      return;
    }
    // Stripe owns the payment step; the listing becomes featured only after it
    // confirms and the backend fulfils the purchase.
    window.location.assign(result.data.checkoutUrl);
  }

  return (
    <div className="figma-info-card white" style={{ padding: 32, marginTop: 24 }}>
      <p style={{ fontWeight: 650, marginBottom: 16 }}>{jobTitle}</p>
      {alreadyFeatured ? (
        <p className="muted" style={{ marginBottom: 16 }}>
          This job is currently featured.
        </p>
      ) : null}

      <div style={{ display: "grid", gap: 14 }}>
        {packages.map((pkg) => (
          <label key={pkg.id} className="emp-plan-option">
            <input type="radio" name="package" checked={selected === pkg.id} onChange={() => setSelected(pkg.id)} />
            <span>
              <strong>{pkg.name} {pkg.unit}</strong>
              <small>{pkg.priceLabel}</small>
            </span>
          </label>
        ))}
      </div>

      {status === "failed" ? (
        <div style={{ marginTop: 20 }}>
          <EmployerStatePanel kind="error" title="We couldn't start that purchase" message={reason} />
        </div>
      ) : null}

      <button className="figma-btn figma-btn-orange" type="button" style={{ width: "100%", marginTop: 22 }} onClick={handleCheckout} disabled={status === "submitting"}>
        {status === "submitting" ? "Starting checkout…" : "Continue to Checkout"}
      </button>

      <p className="muted" style={{ marginTop: 14, fontSize: 13 }}>
        Your job is promoted only after payment is confirmed.
      </p>
      <button type="button" className="emp-btn-secondary" style={{ marginTop: 10 }} onClick={() => router.refresh()}>
        Refresh featured status
      </button>
    </div>
  );
}
