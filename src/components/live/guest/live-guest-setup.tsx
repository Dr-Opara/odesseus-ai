"use client";

import { useState } from "react";

/**
 * Guest Live setup (F12).
 *
 * The guest supplies their own interview context. Nothing here comes from the
 * owner: the form is the guest's own name, company, role, job description,
 * resume, interview type, round, and notes, and the token-scoped setup route
 * writes them to the guest record only. The owner's profile, resumes,
 * applications, and interview history are never read, and there is no field
 * that could bind the guest to them.
 *
 * The field set and the interview-type list are the route's own
 * `guestSetupSchema`, so the form cannot offer a value the server would
 * refuse, and a field the server requires cannot be missing here.
 *
 * The resume is a separate upload with its own state, because it is a
 * multipart request with its own validation and its own failure modes. Both
 * are saved by the same Continue button, and a resume failure does not discard
 * what was already typed.
 *
 * **No coding-assistance option.** The interview-type list has no coding or
 * systems-design entry, and none is added. Odesseus Live is an interview
 * preparation and memory product; it does not generate code, does not answer
 * algorithm questions, and has no IDE integration. `technical` here means a
 * technical discussion, which is an interview like any other.
 */

type SetupState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "resume-uploading" }
  | { kind: "unavailable"; message: string };

/** The interview types the setup route accepts, in its own vocabulary. */
const INTERVIEW_TYPES = [
  { value: "", label: "Not stated" },
  { value: "recruiter", label: "Recruiter screen" },
  { value: "hiring_manager", label: "Hiring manager" },
  { value: "behavioral", label: "Behavioral" },
  { value: "technical", label: "Technical discussion" },
  { value: "panel", label: "Panel" },
  { value: "executive", label: "Executive" },
  { value: "other", label: "Something else" },
] as const;

function readError(payload: unknown, fallback: string): string {
  const error = (payload as { error?: unknown } | null)?.error;
  return typeof error === "string" && error ? error : fallback;
}

export default function LiveGuestSetup({
  token,
  onSaved,
}: {
  token: string;
  /** Called once the setup is saved, so the landing can advance to Live. */
  onSaved: () => void;
}) {
  const [state, setState] = useState<SetupState>({ kind: "idle" });
  const [resumeName, setResumeName] = useState<string | null>(null);
  const [resumeParsed, setResumeParsed] = useState(false);

  const base = `/api/live/guest-access/${encodeURIComponent(token)}`;

  async function uploadResume(file: File) {
    setState({ kind: "resume-uploading" });
    try {
      const form = new FormData();
      form.append("resume", file);
      const response = await fetch(`${base}/resume`, { method: "POST", body: form });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setState({
          kind: "unavailable",
          message: readError(payload, "Odesseus could not store your resume."),
        });
        return;
      }
      setResumeName(file.name);
      setResumeParsed(Boolean((payload as { parsed?: boolean } | null)?.parsed));
      setState({ kind: "idle" });
    } catch {
      setState({
        kind: "unavailable",
        message: "Odesseus could not reach the server. Please try again.",
      });
    }
  }

  async function handleSubmit(formData: FormData) {
    setState({ kind: "saving" });
    try {
      const response = await fetch(`${base}/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(formData.get("name") || ""),
          company: String(formData.get("company") || ""),
          roleTitle: String(formData.get("roleTitle") || ""),
          jobDescription: String(formData.get("jobDescription") || "") || null,
          resumeText: String(formData.get("resumeText") || "") || null,
          interviewType: String(formData.get("interviewType") || "") || null,
          round: String(formData.get("round") || "") || null,
          notes: String(formData.get("notes") || "") || null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setState({
          kind: "unavailable",
          message: readError(payload, "Odesseus could not save your setup."),
        });
        return;
      }
      onSaved();
    } catch {
      setState({
        kind: "unavailable",
        message: "Odesseus could not reach the server. Please try again.",
      });
    }
  }

  const busy = state.kind === "saving" || state.kind === "resume-uploading";

  return (
    <form action={handleSubmit} style={{ marginTop: 26 }}>
      <div className="card" style={{ padding: 28, display: "grid", gap: 18 }}>
        <div>
          <h2 style={{ fontSize: 22, margin: "0 0 4px" }}>Your interview</h2>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            This is your own context. It is not shared with, or visible to, the
            person who sent you the link.
          </p>
        </div>

        <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
          Your name
          <input
            className="input"
            name="name"
            required
            maxLength={200}
            autoComplete="name"
            placeholder="Ada Lovelace"
          />
        </label>

        <div className="figma-two-grid">
          <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
            Company
            <input
              className="input"
              name="company"
              required
              maxLength={200}
              placeholder="Acme Corp"
            />
          </label>
          <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
            Role
            <input
              className="input"
              name="roleTitle"
              required
              maxLength={200}
              placeholder="Security Engineer"
            />
          </label>
        </div>

        <div className="figma-two-grid">
          <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
            Interview type
            <select className="input" name="interviewType" defaultValue="">
              {INTERVIEW_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
            Round{" "}
            <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>
              (optional)
            </span>
            <input
              className="input"
              name="round"
              maxLength={100}
              placeholder="2"
            />
          </label>
        </div>

        <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
          Job description{" "}
          <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>
            (optional)
          </span>
          <textarea
            className="input"
            name="jobDescription"
            rows={5}
            maxLength={20000}
            placeholder="Paste the posting, or the parts you were given."
          />
        </label>

        <div>
          <div style={{ fontWeight: 650, marginBottom: 8 }}>
            Resume{" "}
            <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>
              (optional)
            </span>
          </div>
          <input
            className="input"
            type="file"
            // The visible "Resume (optional)" caption is a div, not a <label>,
            // so without this the control reaches a screen reader unnamed.
            aria-label="Resume"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadResume(file);
            }}
            disabled={busy}
          />
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
            PDF or DOCX, up to 10&nbsp;MB. Or paste the text below.
          </p>
          {resumeName ? (
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }} role="status">
              {resumeName} uploaded{resumeParsed ? " and read." : "."} It stays
              with this link and is not added to anyone&rsquo;s Resume Hub.
            </p>
          ) : null}
        </div>

        <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
          Resume text{" "}
          <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>
            (optional)
          </span>
          <textarea
            className="input"
            name="resumeText"
            rows={6}
            maxLength={60000}
            placeholder="Or paste your resume here."
          />
        </label>

        <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
          Anything else you want ready{" "}
          <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>
            (optional)
          </span>
          <textarea
            className="input"
            name="notes"
            rows={4}
            maxLength={10000}
            placeholder="Panel feedback, who is joining, anything unusual about this round."
          />
        </label>

        {state.kind === "unavailable" ? (
          <p className="muted" style={{ margin: 0 }} role="alert">
            {state.message}
          </p>
        ) : null}

        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy}
          style={{ justifySelf: "start" }}
        >
          {state.kind === "resume-uploading"
            ? "Uploading resume…"
            : state.kind === "saving"
              ? "Saving…"
              : "Continue to Live"}
        </button>
      </div>
    </form>
  );
}
