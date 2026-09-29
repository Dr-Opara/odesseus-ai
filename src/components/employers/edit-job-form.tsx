"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateEmployerJob } from "@/lib/employers/jobs-adapter";
import EmployerStatePanel from "@/components/employers/state-panel";
import type { EmployerJobDetail, WorkArrangement } from "@/lib/employers/types";

/**
 * Edit Job form (F13-F). The backend owns the editing window: a published or
 * closed posting answers 409, and that answer is shown exactly as the backend
 * states it. No frontend-only edit rule is invented here.
 */
export default function EditJobForm({ job, orgId }: { job: EmployerJobDetail; orgId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [reason, setReason] = useState("");

  async function handleSubmit(formData: FormData) {
    setStatus("saving");
    setReason("");

    const result = await updateEmployerJob(orgId, job.id, {
      title: String(formData.get("title") || "").trim(),
      location: String(formData.get("location") || "").trim() || undefined,
      workArrangement: (String(formData.get("workArrangement") || "") || undefined) as WorkArrangement | undefined,
      description: String(formData.get("description") || "").trim() || undefined,
      requiredQualificationsText: String(formData.get("requiredQualifications") || "").trim() || undefined,
      preferredQualificationsText: String(formData.get("preferredQualifications") || "").trim() || undefined,
    });

    if (result.status === "unavailable") {
      setReason(result.reason);
      setStatus("failed");
      return;
    }
    setStatus("saved");
    router.refresh();
  }

  return (
    <form action={handleSubmit} className="figma-info-card white" style={{ padding: 32, marginTop: 28 }}>
      <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
        Job title
        <input className="input" name="title" required defaultValue={job.title} />
      </label>
      <div className="figma-two-grid" style={{ marginTop: 18 }}>
        <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
          Location
          <input className="input" name="location" defaultValue={job.location} />
        </label>
        <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
          Work arrangement
          <select className="input" name="workArrangement" defaultValue={job.workArrangement ?? "Remote"}>
            <option>Remote</option>
            <option>Hybrid</option>
            <option>On-site</option>
          </select>
        </label>
      </div>
      <label style={{ display: "grid", gap: 8, marginTop: 18, fontWeight: 650 }}>
        Job description
        <textarea className="input" name="description" rows={6} defaultValue={job.description} />
      </label>
      <label style={{ display: "grid", gap: 8, marginTop: 18, fontWeight: 650 }}>
        Required qualifications <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>(one per line)</span>
        <textarea className="input" name="requiredQualifications" rows={4} defaultValue={job.requiredQualificationsText} />
      </label>
      <label style={{ display: "grid", gap: 8, marginTop: 18, fontWeight: 650 }}>
        Preferred qualifications <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>(one per line)</span>
        <textarea className="input" name="preferredQualifications" rows={4} defaultValue={job.preferredQualificationsText} />
      </label>

      {status === "failed" ? (
        <div style={{ marginTop: 20 }}>
          <EmployerStatePanel kind="error" title="We couldn't save those changes" message={reason} />
        </div>
      ) : null}
      {status === "saved" ? <p style={{ color: "#1d9e4a", fontWeight: 650, fontSize: 13, marginTop: 16 }}>Saved.</p> : null}

      <button className="figma-btn figma-btn-orange" type="submit" style={{ width: "100%", marginTop: 22 }} disabled={status === "saving"}>
        {status === "saving" ? "Saving…" : "Save Changes"}
      </button>
    </form>
  );
}
