"use client";

import { useEffect, useState } from "react";
import { getEmployerProfile, updateCompanyProfile } from "@/lib/employers/onboarding-adapter";
import type { EmployerProfile } from "@/lib/employers/types";
import EmployerStatePanel from "@/components/employers/state-panel";

type FieldState = { companyName: string; companyWebsite: string; industry: string; companySize: string; contactName: string; contactEmail: string };

function toFields(profile: EmployerProfile): FieldState {
  return {
    companyName: profile.companyName,
    companyWebsite: profile.companyWebsite ?? "",
    industry: profile.industry ?? "",
    companySize: profile.companySize ?? "",
    contactName: profile.contactName ?? "",
    contactEmail: profile.contactEmail ?? "",
  };
}

export default function CompanyProfileForm() {
  const [loadStatus, setLoadStatus] = useState<"loading" | "ok" | "unavailable">("loading");
  const [loadReason, setLoadReason] = useState("");
  const [fields, setFields] = useState<FieldState | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "unavailable">("idle");
  const [saveReason, setSaveReason] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getEmployerProfile().then((result) => {
      if (cancelled) return;
      if (result.status === "ok") {
        setFields(toFields(result.data));
        setLoadStatus("ok");
      } else {
        setLoadReason(result.reason);
        setLoadStatus("unavailable");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  function retryLoad() {
    setLoadStatus("loading");
    setReloadToken((t) => t + 1);
  }

  async function handleSave() {
    if (!fields) return;
    setSaveStatus("saving");
    const result = await updateCompanyProfile(fields);
    if (result.status === "ok") {
      setSaveStatus("saved");
    } else {
      setSaveReason(result.reason);
      setSaveStatus("unavailable");
    }
  }

  if (loadStatus === "loading") {
    return (
      <div style={{ marginTop: 24 }}>
        <EmployerStatePanel kind="loading" />
      </div>
    );
  }

  if (loadStatus === "unavailable" || !fields) {
    return (
      <div style={{ marginTop: 24 }}>
        <EmployerStatePanel kind="error" title="Company profile isn't available yet" message={loadReason} onRetry={retryLoad} />
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
        Location
        <input className="input" value={fields.companySize} onChange={(e) => setFields({ ...fields, companySize: e.target.value })} placeholder="Company size" />
      </label>

      {saveStatus === "unavailable" ? <EmployerStatePanel kind="error" title="Couldn't save changes" message={saveReason} onRetry={handleSave} /> : null}
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
