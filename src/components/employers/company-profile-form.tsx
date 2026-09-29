"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveCompanyProfileAction } from "@/lib/employers/actions";
import EmployerStatePanel from "@/components/employers/state-panel";
import type { EmployerProfile } from "@/lib/employers/types";

type FieldState = {
  companyName: string;
  companyWebsite: string;
  industry: string;
  companySize: string;
};

function toFields(profile: EmployerProfile): FieldState {
  return {
    companyName: profile.companyName,
    companyWebsite: profile.companyWebsite ?? "",
    industry: profile.industry ?? "",
    companySize: profile.companySize ?? "",
  };
}

/**
 * Company Profile (Figma screen 85, F13-Q).
 *
 * The profile is read on the server and passed in, rather than fetched from
 * this component: the read is a session-scoped Supabase query, and the module
 * that performs it imports the server client. Passing it as a prop also means
 * the form renders with real values on first paint instead of flashing a
 * loading state on a page that already has the data.
 *
 * Saving is owner-only. The PATCH route refuses anyone else, and that refusal
 * is shown as the backend stated it — a recruiter editing this form is told
 * they cannot, not that the save failed for an unexplained reason.
 */
export default function CompanyProfileForm({
  orgId,
  profile,
}: {
  orgId: string;
  profile: EmployerProfile;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<FieldState>(() => toFields(profile));
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "unavailable">("idle");
  const [saveReason, setSaveReason] = useState("");

  async function handleSave() {
    setSaveStatus("saving");
    setSaveReason("");

    const result = await saveCompanyProfileAction(orgId, fields);

    if (result.status === "unavailable") {
      setSaveReason(result.reason);
      setSaveStatus("unavailable");
      return;
    }

    setSaveStatus("saved");
    // Re-read so the rendered values are the persisted ones, including any
    // server-side normalisation.
    router.refresh();
  }

  return (
    <div className="figma-info-card white" style={{ padding: 32, marginTop: 28, display: "grid", gap: 18 }}>
      <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
        Company name
        <input
          className="input"
          value={fields.companyName}
          onChange={(e) => setFields({ ...fields, companyName: e.target.value })}
        />
      </label>
      <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
        Website
        <input
          className="input"
          value={fields.companyWebsite}
          onChange={(e) => setFields({ ...fields, companyWebsite: e.target.value })}
        />
      </label>
      <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
        Industry
        <input
          className="input"
          value={fields.industry}
          onChange={(e) => setFields({ ...fields, industry: e.target.value })}
        />
      </label>
      <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
        Company size
        <input
          className="input"
          value={fields.companySize}
          onChange={(e) => setFields({ ...fields, companySize: e.target.value })}
          placeholder="e.g. 51-200"
        />
      </label>

      {saveStatus === "unavailable" ? (
        <EmployerStatePanel
          kind="permission-denied"
          title="Couldn&rsquo;t save changes"
          message={saveReason}
          onRetry={handleSave}
        />
      ) : null}
      {saveStatus === "saved" ? (
        <p style={{ color: "#1d9e4a", fontWeight: 650, fontSize: 13 }}>Saved.</p>
      ) : null}

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
