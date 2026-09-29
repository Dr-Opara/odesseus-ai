"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getEmployerProfile, updateCompanyProfile } from "@/lib/employers/onboarding-adapter";
import type { EmployerProfile } from "@/lib/employers/types";
import EmployerStatePanel from "@/components/employers/state-panel";

type FieldState = { companyName: string; companyWebsite: string; industry: string; companySize: string; description: string };

function toFields(profile: EmployerProfile): FieldState {
  return {
    companyName: profile.companyName,
    companyWebsite: profile.companyWebsite ?? "",
    industry: profile.industry ?? "",
    companySize: profile.companySize ?? "",
    description: profile.description ?? "",
  };
}

/**
 * Company Profile (F13-Q). The employer organization row is owner-only on the
 * backend, and a refusal is shown as the backend states it — the form never
 * implies a non-owner edit was saved.
 */
export default function CompanyProfileForm({
  orgId,
  initialProfile,
}: {
  orgId: string;
  initialProfile: EmployerProfile | null;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<FieldState | null>(initialProfile ? toFields(initialProfile) : null);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ok" | "failed">(
    initialProfile ? "ok" : "loading"
  );
  const [loadReason, setLoadReason] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [saveReason, setSaveReason] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  // `reloadToken` is a manual-refresh key, so the read is re-run after a retry
  // rather than being pushed down by an effect on every render.
  useEffect(() => {
    if (initialProfile) return;
    let cancelled = false;
    void getEmployerProfile(orgId).then((result) => {
      if (cancelled) return;
      if (result.status === "ok") {
        setFields(toFields(result.data));
        setLoadStatus("ok");
        return;
      }
      setLoadReason(result.reason);
      setLoadStatus("failed");
    });
    return () => {
      cancelled = true;
    };
  }, [initialProfile, orgId, reloadToken]);

  async function handleSave() {
    if (!fields) return;
    setSaveStatus("saving");
    setSaveReason("");
    const result = await updateCompanyProfile(orgId, {
      companyName: fields.companyName.trim(),
      companyWebsite: fields.companyWebsite.trim() || undefined,
      industry: fields.industry.trim() || undefined,
      companySize: fields.companySize.trim() || undefined,
      description: fields.description.trim() || undefined,
    });
    if (result.status === "ok") {
      setFields(toFields(result.data));
      setSaveStatus("saved");
      router.refresh();
      return;
    }
    setSaveReason(result.reason);
    setSaveStatus("failed");
  }

  if (loadStatus === "loading") {
    return (
      <div style={{ marginTop: 24 }}>
        <EmployerStatePanel kind="loading" />
      </div>
    );
  }

  if (loadStatus === "failed" || !fields) {
    return (
      <div style={{ marginTop: 24 }}>
        <EmployerStatePanel
          kind="error"
          title="We couldn&rsquo;t load your company profile"
          message={loadReason}
          onRetry={() => {
            setLoadStatus("loading");
            setReloadToken((token) => token + 1);
          }}
        />
      </div>
    );
  }

  return (
    <div className="figma-info-card white" style={{ padding: 32, marginTop: 28, display: "grid", gap: 18 }}>
      <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
        Company name
        <input className="input" value={fields.companyName} onChange={(e) => setFields({ ...fields, companyName: e.target.value })} />
      </label>
      <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
        Website
        <input className="input" value={fields.companyWebsite} onChange={(e) => setFields({ ...fields, companyWebsite: e.target.value })} />
      </label>
      <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
        Industry
        <input className="input" value={fields.industry} onChange={(e) => setFields({ ...fields, industry: e.target.value })} />
      </label>
      <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
        Company size
        <input className="input" value={fields.companySize} onChange={(e) => setFields({ ...fields, companySize: e.target.value })} placeholder="51-200" />
      </label>
      <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
        Company description
        <textarea className="input" rows={4} value={fields.description} onChange={(e) => setFields({ ...fields, description: e.target.value })} />
      </label>

      {saveStatus === "failed" ? (
        <EmployerStatePanel kind="error" title="Couldn't save changes" message={saveReason} />
      ) : null}
      {saveStatus === "saved" ? <p style={{ color: "#1d9e4a", fontWeight: 650, fontSize: 13 }}>Saved.</p> : null}

      <button
        className="figma-btn figma-btn-orange"
        type="button"
        style={{ width: "100%" }}
        disabled={saveStatus === "saving"}
        onClick={handleSave}
      >
        {saveStatus === "saving" ? "Saving…" : "Save Company Profile"}
      </button>
    </div>
  );
}
