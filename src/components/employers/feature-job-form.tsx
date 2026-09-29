"use client";

import { useState } from "react";
import { purchaseFeaturedJob, type FeaturedJobPackage } from "@/lib/employers/featured-adapter";
import EmployerStatePanel from "@/components/employers/state-panel";
import type { FeaturedJobPackageId } from "@/lib/employers/types";

/** Featured job package selection + purchase (F13-O). Never marks a job featured until the backend confirms it. */
export default function FeatureJobForm({
  jobId,
  jobTitle,
  packages,
  alreadyFeatured,
}: {
  jobId: string;
  jobTitle: string;
  packages: FeaturedJobPackage[];
  alreadyFeatured: boolean;
}) {
  const [selected, setSelected] = useState<FeaturedJobPackageId>(packages[0]?.id);
  const [status, setStatus] = useState<"idle" | "submitting" | "unavailable">("idle");
  const [reason, setReason] = useState("");

  async function handleCheckout() {
    setStatus("submitting");
    const result = await purchaseFeaturedJob(jobId, selected);
    if (result.status === "unavailable") {
      setReason(result.reason);
      setStatus("unavailable");
    } else {
      setStatus("idle");
    }
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

      {status === "unavailable" ? (
        <div style={{ marginTop: 20 }}>
          <EmployerStatePanel kind="error" title="Featured listings aren't available yet" message={reason} />
        </div>
      ) : null}

      <button className="figma-btn figma-btn-orange" type="button" style={{ width: "100%", marginTop: 22 }} onClick={handleCheckout} disabled={status === "submitting"}>
        {status === "submitting" ? "Processing…" : "Continue to Checkout"}
      </button>
    </div>
  );
}
