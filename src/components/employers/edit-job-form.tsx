"use client";

import { useState } from "react";
import { updateEmployerJob } from "@/lib/employers/jobs-adapter";
import EmployerStatePanel from "@/components/employers/state-panel";
import type { EmployerJobDetail } from "@/lib/employers/types";

function linesToArray(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Edit Job form (F13-F). If the backend limits editing after publication,
 * that limit must come from the backend's response, never a frontend-only
 * rule invented here — today the adapter is honestly unavailable, so no
 * such restriction is asserted client-side.
 */
export default function EditJobForm({ job }: { job: EmployerJobDetail }) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "unavailable">("idle");
  const [reason, setReason] = useState("");

  async function handleSubmit(formData: FormData) {
    setStatus("saving");
    const result = await updateEmployerJob(job.id, {
      title: String(formData.get("title") || ""),
      department: String(formData.get("department") || "") || undefined,
      employmentType: String(formData.get("employmentType") || "") || undefined,
      location: String(formData.get("location") || "") || undefined,
      workArrangement: (String(formData.get("workArrangement") || "") || undefined) as "Remote" | "Hybrid" | "On-site" | undefined,
      compensationText: String(formData.get("compensationText") || "") || undefined,
      description: String(formData.get("description") || "") || undefined,
      responsibilities: linesToArray(String(formData.get("responsibilities") || "")),
      requiredQualifications: linesToArray(String(formData.get("requiredQualifications") || "")),
      preferredQualifications: linesToArray(String(formData.get("preferredQualifications") || "")),
    });
    if (result.status === "unavailable") {
      setReason(result.reason);
      setStatus("unavailable");
    } else {
      setStatus("saved");
    }
  }

  return (
    <form action={handleSubmit} className="figma-info-card white" style={{ padding: 32, marginTop: 28 }}>
      <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
        Job title
        <input className="input" name="title" required defaultValue={job.title} />
      </label>
      <div className="figma-two-grid" style={{ marginTop: 18 }}>
        <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
          Department
          <input className="input" name="department" defaultValue={job.department} />
        </label>
        <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
          Employment type
          <select className="input" name="employmentType" defaultValue={job.employmentType || "Full-time"}>
            <option>Full-time</option>
            <option>Contract</option>
            <option>Part-time</option>
          </select>
        </label>
      </div>
      <div className="figma-two-grid" style={{ marginTop: 18 }}>
        <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
          Location
          <input className="input" name="location" defaultValue={job.location} />
        </label>
        <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
          Work arrangement
          <select className="input" name="workArrangement" defaultValue={job.workArrangement || "Remote"}>
            <option>Remote</option>
            <option>Hybrid</option>
            <option>On-site</option>
          </select>
        </label>
      </div>
      <label style={{ display: "grid", gap: 8, marginTop: 18, fontWeight: 650 }}>
        Compensation <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>(optional)</span>
        <input className="input" name="compensationText" defaultValue={job.compensationText} />
      </label>
      <label style={{ display: "grid", gap: 8, marginTop: 18, fontWeight: 650 }}>
        Job description
        <textarea className="input" name="description" rows={6} defaultValue={job.description} />
      </label>
      <label style={{ display: "grid", gap: 8, marginTop: 18, fontWeight: 650 }}>
        Responsibilities <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>(one per line)</span>
        <textarea className="input" name="responsibilities" rows={4} defaultValue={job.responsibilities?.join("\n")} />
      </label>
      <label style={{ display: "grid", gap: 8, marginTop: 18, fontWeight: 650 }}>
        Required qualifications <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>(one per line)</span>
        <textarea className="input" name="requiredQualifications" rows={4} defaultValue={job.requiredQualifications?.join("\n")} />
      </label>
      <label style={{ display: "grid", gap: 8, marginTop: 18, fontWeight: 650 }}>
        Preferred qualifications <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>(one per line)</span>
        <textarea className="input" name="preferredQualifications" rows={4} defaultValue={job.preferredQualifications?.join("\n")} />
      </label>

      {status === "unavailable" ? (
        <div style={{ marginTop: 20 }}>
          <EmployerStatePanel kind="error" title="Saving isn't available yet" message={reason} />
        </div>
      ) : null}
      {status === "saved" ? <p style={{ color: "#1d9e4a", fontWeight: 650, fontSize: 13, marginTop: 16 }}>Saved.</p> : null}

      <button className="figma-btn figma-btn-orange" type="submit" style={{ width: "100%", marginTop: 22 }} disabled={status === "saving"}>
        {status === "saving" ? "Saving…" : "Save Changes"}
      </button>
    </form>
  );
}
