"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveEmployerJobAction, transitionJobAction } from "@/lib/employers/actions";
import {
  JOB_EMPLOYMENT_TYPES,
  toFormEmploymentType,
} from "@/lib/employer/service";
import EmployerStatePanel from "@/components/employers/state-panel";

function linesToArray(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Post Job (Figma screen 75, F13-E) on the real backend.
 *
 * Two deliberate steps, because the backend treats them as two:
 *
 *  1. **Create** writes a draft. Creating never publishes, so the employer can
 *     review the role before it consumes any of their plan's job posts.
 *  2. **Publish** is a separate confirmation that goes through the jobs
 *     route, which enforces the plan's active-job capacity and consumes the
 *     credit through the `claim_job_post_credit` trigger. A refusal — no plan,
 *     or at capacity — is shown as the route stated it.
 *
 * Compensation is optional and is never invented. Department, employment type,
 * and responsibilities are folded into the stored description rather than
 * discarded, so nothing the employer typed is lost.
 */
export default function PostJobForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [draftId, setDraftId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setSaving(true);
    setFailure(null);

    const result = await saveEmployerJobAction(orgId, {
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
    });

    setSaving(false);

    if (result.status === "unavailable") {
      setFailure(result.reason);
      return;
    }

    // The draft is real and has an id. Offer to publish it, but never publish
    // on the employer's behalf.
    setDraftId(result.data.id);
  }

  async function publish() {
    if (!draftId) return;
    setPublishing(true);
    setFailure(null);

    const result = await transitionJobAction(orgId, draftId, "publish");
    setPublishing(false);

    if (result.status === "unavailable") {
      setFailure(result.reason);
      return;
    }

    setPublished(true);
    router.refresh();
  }

  if (published) {
    return (
      <div style={{ marginTop: 28 }}>
        <div className="emp-capacity-badge">
          <div className="emp-capacity-badge-row">
            <span>Your job is live.</span>
          </div>
        </div>
        <div className="emp-page-actions">
          <Link className="figma-btn figma-btn-orange" href="/employers/dashboard/jobs">
            View your jobs
          </Link>
          <Link className="emp-btn-secondary" href="/employers/candidates">
            See applicants
          </Link>
        </div>
      </div>
    );
  }

  const hasDraft = draftId !== null;

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
          {/* The database's vocabulary, so the form cannot submit a value the
              check constraint would refuse. "Not stated" is a real option: an
              employer who has not said is recorded as unknown rather than
              defaulting to full-time, which would put the job in front of
              candidates who filtered for full-time roles. */}
          <select className="input" name="employmentType" defaultValue="">
            <option value="">Not stated</option>
            {JOB_EMPLOYMENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {toFormEmploymentType(value)}
              </option>
            ))}
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

      {hasDraft ? (
        <div className="emp-capacity-badge" style={{ marginTop: 20 }} role="status">
          <div className="emp-capacity-badge-row">
            <span>Draft saved. Publishing uses one of your plan&rsquo;s job posts.</span>
          </div>
          <div className="emp-page-actions">
            <button
              type="button"
              className="figma-btn figma-btn-orange"
              onClick={publish}
              disabled={publishing}
            >
              {publishing ? "Publishing…" : "Publish this job"}
            </button>
            <Link className="emp-btn-secondary" href={`/employers/jobs/${draftId}/edit`}>
              Review the draft
            </Link>
          </div>
        </div>
      ) : null}

      {failure ? (
        <div style={{ marginTop: 20 }}>
          <EmployerStatePanel
            kind={hasDraft ? "capacity-reached" : "error"}
            title="Could not post this job"
            message={failure}
          />
        </div>
      ) : null}

      {hasDraft ? null : (
        <button
          className="figma-btn figma-btn-orange"
          type="submit"
          style={{ width: "100%", marginTop: 22 }}
          disabled={saving}
        >
          {saving ? "Saving draft…" : "Save as draft"}
        </button>
      )}
    </form>
  );
}
