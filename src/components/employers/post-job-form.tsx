"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createEmployerJob, publishEmployerJob } from "@/lib/employers/jobs-adapter";
import EmployerStatePanel from "@/components/employers/state-panel";
import type { WorkArrangement } from "@/lib/employers/types";

/**
 * Post Job form (F13-E). The employer posting record stores a title,
 * description, location, work arrangement, and the requirement texts, so
 * those are exactly the fields offered here — nothing typed is silently
 * dropped. Creating produces a draft; publishing is a separate call, and a
 * plan-capacity or credit refusal is shown with the backend's own wording.
 */
export default function PostJobForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "failed">("idle");
  const [reason, setReason] = useState("");

  async function handleSubmit(formData: FormData) {
    setStatus("submitting");
    setReason("");

    const created = await createEmployerJob(orgId, {
      title: String(formData.get("title") || "").trim(),
      location: String(formData.get("location") || "").trim() || undefined,
      workArrangement: (String(formData.get("workArrangement") || "") || undefined) as WorkArrangement | undefined,
      description: String(formData.get("description") || "").trim() || undefined,
      requiredQualificationsText: String(formData.get("requiredQualifications") || "").trim() || undefined,
      preferredQualificationsText: String(formData.get("preferredQualifications") || "").trim() || undefined,
    });

    if (created.status === "unavailable") {
      setReason(created.reason);
      setStatus("failed");
      return;
    }

    const published = await publishEmployerJob(orgId, created.data.id);
    if (published.status === "unavailable") {
      // The draft exists; publishing is what the plan refused.
      setReason(`${published.reason} Your job was saved as a draft.`);
      setStatus("failed");
      router.refresh();
      return;
    }

    setStatus("done");
    router.push(`/employers/jobs/${created.data.id}`);
  }

  return (
    <form action={handleSubmit} className="figma-info-card white" style={{ padding: 32, marginTop: 28 }}>
      <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
        Job title
        <input className="input" name="title" required placeholder="AI Security Engineer" />
      </label>
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
        Job description
        <textarea className="input" name="description" rows={6} placeholder="Role summary and requirements…" />
      </label>
      <label style={{ display: "grid", gap: 8, marginTop: 18, fontWeight: 650 }}>
        Required qualifications <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>(one per line)</span>
        <textarea className="input" name="requiredQualifications" rows={4} />
      </label>
      <label style={{ display: "grid", gap: 8, marginTop: 18, fontWeight: 650 }}>
        Preferred qualifications <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>(one per line)</span>
        <textarea className="input" name="preferredQualifications" rows={4} />
      </label>

      {status === "failed" ? (
        <div style={{ marginTop: 20 }}>
          <EmployerStatePanel kind="error" title="We couldn't publish that job" message={reason} />
        </div>
      ) : null}

      <button className="figma-btn figma-btn-orange" type="submit" style={{ width: "100%", marginTop: 22 }} disabled={status === "submitting"}>
        {status === "submitting" ? "Publishing…" : "Publish Job"}
      </button>
    </form>
  );
}
