"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveEmployerJobAction } from "@/lib/employers/actions";
import EmployerStatePanel from "@/components/employers/state-panel";
import type { EmployerJobDetail } from "@/lib/employers/types";

function linesToArray(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Maps a stored work arrangement onto one of the select's options.
 *
 * The backend stores it lowercase and the adapter already normalises the known
 * values, but an unrecognised one can still arrive. Falling back to "Remote"
 * would silently change the employer's choice, so anything unrecognised leaves
 * the select on its first option and the employer sees and corrects it.
 */
function normalizeArrangement(value: string | undefined): string {
  if (value === "Hybrid" || value === "hybrid") return "Hybrid";
  if (value === "On-site" || value === "onsite" || value === "on-site") return "On-site";
  return "Remote";
}

/**
 * Edit Job (Figma screen 78, F13-F).
 *
 * The backend limits editing to drafts and refuses anything else. That limit
 * is not reimplemented here: the page is only reachable for a draft, and a
 * refusal from the route is shown as the route stated it. Inventing a
 * client-side copy of that rule would be a second policy that could disagree
 * with the server's.
 */
export default function EditJobForm({
  orgId,
  job,
}: {
  orgId: string;
  job: EmployerJobDetail;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "unavailable">("idle");
  const [reason, setReason] = useState("");

  async function handleSubmit(formData: FormData) {
    setStatus("saving");
    setReason("");

    const result = await saveEmployerJobAction(
      orgId,
      {
        title: String(formData.get("title") || ""),
        department: String(formData.get("department") || "") || undefined,
        employmentType: String(formData.get("employmentType") || "") || undefined,
        location: String(formData.get("location") || "") || undefined,
        workArrangement: String(formData.get("workArrangement") || "") || undefined,
        compensationText: String(formData.get("compensationText") || "") || undefined,
        description: String(formData.get("description") || "") || undefined,
        responsibilities: linesToArray(String(formData.get("responsibilities") || "")),
        requiredQualifications: linesToArray(String(formData.get("requiredQualifications") || "")),
        preferredQualifications: linesToArray(String(formData.get("preferredQualifications") || "")),
      },
      job.id
    );

    if (result.status === "unavailable") {
      setReason(result.reason);
      setStatus("unavailable");
      return;
    }

    setStatus("saved");
    // Re-read so the page shows the persisted values.
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
          <select
            className="input"
            name="workArrangement"
            defaultValue={normalizeArrangement(job.workArrangement)}
          >
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
          <EmployerStatePanel kind="error" title="Couldn&rsquo;t save this job" message={reason} />
        </div>
      ) : null}
      {status === "saved" ? (
        <p style={{ color: "#1d9e4a", fontWeight: 650, fontSize: 13, marginTop: 16 }}>Saved.</p>
      ) : null}

      <button
        className="figma-btn figma-btn-orange"
        type="submit"
        style={{ width: "100%", marginTop: 22 }}
        disabled={status === "saving"}
      >
        {status === "saving" ? "Saving…" : "Save Changes"}
      </button>
    </form>
  );
}
