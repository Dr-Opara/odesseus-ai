"use client";

import { useState } from "react";
import { saveGuestSetup, uploadGuestResume, type GuestSetupInput } from "@/lib/live/guest-share";
import type { GuestInterviewType } from "@/lib/live/live-types";

const INTERVIEW_TYPES: { value: GuestInterviewType; label: string }[] = [
  { value: "recruiter", label: "Recruiter screen" },
  { value: "hiring_manager", label: "Hiring manager" },
  { value: "behavioral", label: "Behavioral" },
  { value: "technical", label: "Technical" },
  { value: "panel", label: "Panel" },
  { value: "executive", label: "Executive" },
  { value: "other", label: "Other" },
];

/**
 * Guest setup (F2). Everything captured here belongs to the guest session: the
 * guest's own name, company, role, job description, resume, interview type,
 * round, and notes. Nothing is written to the link owner's profile, Resume
 * Hub, applications, or wallet.
 *
 * Odesseus Live is interview support only. It does not assist with coding
 * exercises or take-home assignments, and the form says so plainly.
 */
export default function GuestSetupForm({ token, onComplete }: { token: string; onComplete: () => void }) {
  const [form, setForm] = useState<GuestSetupInput>({
    name: "",
    company: "",
    roleTitle: "",
    jobDescription: "",
    resumeText: "",
    interviewType: "hiring_manager",
    round: "",
    notes: "",
  });
  const [resumeName, setResumeName] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "failed">("idle");
  const [reason, setReason] = useState("");

  async function handleResume(file: File | null) {
    if (!file) return;
    setResumeError(null);
    const error = await uploadGuestResume(token, file);
    if (error) {
      setResumeError(error);
      return;
    }
    setResumeName(file.name);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setReason("");

    const error = await saveGuestSetup(token, {
      name: form.name.trim(),
      company: form.company.trim(),
      roleTitle: form.roleTitle.trim(),
      jobDescription: form.jobDescription?.trim(),
      resumeText: form.resumeText?.trim(),
      interviewType: form.interviewType,
      round: form.round?.trim(),
      notes: form.notes?.trim(),
    });

    if (error) {
      setReason(error);
      setStatus("failed");
      return;
    }
    onComplete();
  }

  return (
    <form className="card" style={{ padding: 32, display: "grid", gap: 18 }} onSubmit={handleSubmit}>
      <div>
        <div className="badge">Odesseus Live · Guest</div>
        <h1 style={{ fontSize: 32, margin: "14px 0 8px" }}>Set up your interview.</h1>
        <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
          Tell Odesseus what you are interviewing for so your guidance stays grounded in this
          role. No account, no login, and no payment — this session is private to your link.
        </p>
      </div>

      <div className="figma-two-grid" style={{ gap: 18 }}>
        <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
          Your name
          <input
            className="input"
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Jordan Okafor"
          />
        </label>
        <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
          Company
          <input
            className="input"
            required
            value={form.company}
            onChange={(event) => setForm({ ...form, company: event.target.value })}
            placeholder="Northwind Labs"
          />
        </label>
      </div>

      <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
        Role or title
        <input
          className="input"
          required
          value={form.roleTitle}
          onChange={(event) => setForm({ ...form, roleTitle: event.target.value })}
          placeholder="Senior Backend Engineer"
        />
      </label>

      <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
        Job description
        <textarea
          className="input"
          rows={5}
          value={form.jobDescription}
          onChange={(event) => setForm({ ...form, jobDescription: event.target.value })}
          placeholder="Paste the job description you were given."
        />
      </label>

      <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
        Resume
        <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>
          Upload a PDF or DOCX, or paste your resume text below. It stays with this guest session.
        </span>
        <input
          className="input"
          type="file"
          accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(event) => void handleResume(event.target.files?.[0] ?? null)}
        />
        {resumeName ? <small style={{ color: "#1d9e4a", fontWeight: 650 }}>{resumeName} uploaded</small> : null}
        {resumeError ? <small className="apply-error">{resumeError}</small> : null}
      </label>

      <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
        Resume text
        <textarea
          className="input"
          rows={4}
          value={form.resumeText}
          onChange={(event) => setForm({ ...form, resumeText: event.target.value })}
          placeholder="Paste your resume if you would rather not upload a file."
        />
      </label>

      <div className="figma-two-grid" style={{ gap: 18 }}>
        <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
          Interview type
          <select
            className="input"
            value={form.interviewType}
            onChange={(event) => setForm({ ...form, interviewType: event.target.value as GuestInterviewType })}
          >
            {INTERVIEW_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
          Round
          <input
            className="input"
            value={form.round}
            onChange={(event) => setForm({ ...form, round: event.target.value })}
            placeholder="2"
          />
        </label>
      </div>

      <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
        Notes for this interview
        <textarea
          className="input"
          rows={3}
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
          placeholder="Anything Odesseus should keep in mind — panel format, focus areas, time limits."
        />
      </label>

      <div className="review-note">
        Odesseus Live supports you while you answer questions. It does not help with coding
        exercises, take-home assignments, or assessments.
      </div>

      {status === "failed" ? <p className="apply-error">{reason}</p> : null}

      <button className="figma-btn figma-btn-orange" type="submit" disabled={status === "saving"}>
        {status === "saving" ? "Saving…" : "Continue to Odesseus Live"}
      </button>
    </form>
  );
}
