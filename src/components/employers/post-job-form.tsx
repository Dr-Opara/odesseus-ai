"use client";

import { useState } from "react";
import { createEmployerJob } from "@/lib/employers/jobs-adapter";
import EmployerStatePanel from "@/components/employers/state-panel";

function linesToArray(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Post Job form (F13-E). Salary is optional and never invented. */
export default function PostJobForm() {
  const [status, setStatus] = useState<"idle" | "submitting" | "unavailable">("idle");
  const [reason, setReason] = useState("");

  async function handleSubmit(formData: FormData) {
    setStatus("submitting");
    const result = await createEmployerJob({
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
      setStatus("idle");
    }
  }

  return (
    <form action={handleSubmit} className="figma-info-card white" style={{ padding: 32, marginTop: 28 }}>
      <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
        Job title
        <input className="input" name="title" required placeholder="AI Security Engineer" />
      </label>
      <div className="figma-two-grid" style={{ marginTop: 18 }}>
        <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
          Department
          <input className="input" name="department" placeholder="Engineering" />
        </label>
        <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
          Employment type
          <select className="input" name="employmentType" defaultValue="Full-time">
            <option>Full-time</option>
            <option>Contract</option>
            <option>Part-time</option>
          </select>
        </label>
      </div>
      <div className="figma-two-grid" style={{ marginTop: 18 }}>
        <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
          Location
          <input className="input" name="location" placeholder="Remote · US" />
        </label>
        <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
          Work arrangement
          <select className="input" name="workArrangement" defaultValue="Remote">
            <option>Remote</option>
            <option>Hybrid</option>
            <option>On-site</option>
          </select>
        </label>
      </div>
      <label style={{ display: "grid", gap: 8, marginTop: 18, fontWeight: 650 }}>
        Compensation <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>(optional)</span>
        <input className="input" name="compensationText" placeholder="$180K–$220K" />
      </label>
      <label style={{ display: "grid", gap: 8, marginTop: 18, fontWeight: 650 }}>
        Job description
        <textarea className="input" name="description" rows={6} placeholder="Role summary and requirements…" />
      </label>
      <label style={{ display: "grid", gap: 8, marginTop: 18, fontWeight: 650 }}>
        Responsibilities <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>(one per line)</span>
        <textarea className="input" name="responsibilities" rows={4} />
      </label>
      <label style={{ display: "grid", gap: 8, marginTop: 18, fontWeight: 650 }}>
        Required qualifications <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>(one per line)</span>
        <textarea className="input" name="requiredQualifications" rows={4} />
      </label>
      <label style={{ display: "grid", gap: 8, marginTop: 18, fontWeight: 650 }}>
        Preferred qualifications <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>(one per line)</span>
        <textarea className="input" name="preferredQualifications" rows={4} />
      </label>

      {status === "unavailable" ? (
        <div style={{ marginTop: 20 }}>
          <EmployerStatePanel kind="error" title="Publishing isn't available yet" message={reason} />
        </div>
      ) : null}

      <button className="figma-btn figma-btn-orange" type="submit" style={{ width: "100%", marginTop: 22 }} disabled={status === "submitting"}>
        {status === "submitting" ? "Publishing…" : "Publish Job"}
      </button>
    </form>
  );
}
