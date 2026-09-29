"use client";

import { useState } from "react";
import { startFeaturedCheckoutAction } from "@/lib/employers/actions";
import EmployerStatePanel from "@/components/employers/state-panel";
import type { FeaturedJobPackage } from "@/lib/employers/featured-packages";

/**
 * Featured job package selection and purchase (F13-O).
 *
 * This never marks a job featured. It starts a Stripe checkout through the
 * org's featured route — which refuses a closed job before any payment step,
 * and takes its price from the billing catalog rather than from this
 * component — and sends the employer to the hosted page. The boost begins only
 * once the webhook confirms payment and the backend activates the listing.
 */
export default function FeatureJobForm({
  orgId,
  jobId,
  jobTitle,
  jobStatus,
  packages,
  alreadyFeatured,
}: {
  orgId: string;
  jobId: string;
  jobTitle: string;
  jobStatus: string;
  packages: FeaturedJobPackage[];
  alreadyFeatured: boolean;
}) {
  const [selected, setSelected] = useState(packages[0]?.tier);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const chosen = packages.find((pkg) => pkg.tier === selected);
  // The backend refuses to feature a closed job, so the button is disabled
  // rather than letting the employer reach a checkout that would 409.
  const closed = jobStatus === "Closed";

  async function handleCheckout() {
    if (!chosen) return;
    setPending(true);
    setFailure(null);
    const result = await startFeaturedCheckoutAction(orgId, jobId, chosen.tier);
    setPending(false);

    if (result.status === "unavailable") {
      setFailure(result.reason);
      return;
    }
    window.location.assign(result.data.url);
  }

  return (
    <div className="figma-info-card white" style={{ padding: 32, marginTop: 24 }}>
      <p style={{ fontWeight: 650, marginBottom: 16 }}>{jobTitle}</p>
      {alreadyFeatured ? (
        <p className="muted" style={{ marginBottom: 16 }}>
          This job is currently featured.
        </p>
      ) : null}
      {closed ? (
        <p className="muted" style={{ marginBottom: 16 }}>
          This job is closed, so it cannot be featured.
        </p>
      ) : null}

      <div style={{ display: "grid", gap: 14 }}>
        {packages.map((pkg) => (
          <label key={pkg.tier} className="emp-plan-option">
            <input
              type="radio"
              name="package"
              checked={selected === pkg.tier}
              onChange={() => setSelected(pkg.tier)}
            />
            <span>
              <strong>
                {pkg.name} {pkg.unit}
              </strong>
              <small>{pkg.priceLabel}</small>
            </span>
          </label>
        ))}
      </div>

      {failure ? (
        <div style={{ marginTop: 20 }}>
          <EmployerStatePanel
            kind="error"
            title="Could not start the featured checkout"
            message={failure}
          />
        </div>
      ) : null}

      <button
        className="figma-btn figma-btn-orange"
        type="button"
        style={{ width: "100%", marginTop: 22 }}
        onClick={handleCheckout}
        disabled={pending || alreadyFeatured || closed || !chosen}
      >
        {pending
          ? "Opening checkout…"
          : chosen
            ? `Continue to Checkout · ${chosen.priceLabel}`
            : "Continue to Checkout"}
      </button>
      <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
        The promotion starts once payment is confirmed. A closed job cannot be featured.
      </p>
    </div>
  );
}
