"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  saveProfileAndPreferences,
  uploadMasterResume,
  validateResumeFile,
} from "@/lib/onboarding/submit";
import MobileOnboardingProgress from "@/components/mobile/mobile-onboarding-progress";

/**
 * Mobile Resume (screen 03) + Preferences (screen 04).
 *
 * Two visual steps over the same real onboarding submission the desktop form
 * uses (`@/lib/onboarding/submit`): the resume uploads to Supabase Storage as
 * soon as step 3 continues, then step 4 saves the profile/preferences and
 * completes onboarding — the exact same two calls the desktop form makes, in
 * the same order, just split across two screens instead of one.
 */
export default function MobileOnboardingWizard({
  fullName,
}: {
  fullName: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState<3 | 4>(3);
  const [file, setFile] = useState<File | null>(null);
  const [targetRole, setTargetRole] = useState("");
  const [location, setLocation] = useState("");
  const [minimumSalary, setMinimumSalary] = useState("");
  const [workPreference, setWorkPreference] = useState("remote");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function continueToPreferences(event: FormEvent) {
    event.preventDefault();
    const validationError = validateResumeFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setBusy(true);

    const { data: authData, error: authError } = await supabase.auth.getUser();
    const user = authData.user;
    if (authError || !user) {
      setBusy(false);
      router.push("/login");
      return;
    }

    const result = await uploadMasterResume(supabase, user.id, file!);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setStep(4);
  }

  async function finishSetup(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);

    const { data: authData, error: authError } = await supabase.auth.getUser();
    const user = authData.user;
    if (authError || !user) {
      setBusy(false);
      router.push("/login");
      return;
    }

    const result = await saveProfileAndPreferences(supabase, user.id, {
      fullName: fullName || user.user_metadata?.full_name || null,
      targetRole,
      location,
      workPreference,
      minimumSalary,
    });

    if (result.error) {
      setError(result.error);
      setBusy(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  if (step === 4) {
    return (
      <main className="odesseus-mobile-only m-screen m-screen-04">
        <header className="m-screen-header">
          <button type="button" onClick={() => setStep(3)} aria-label="Back">
            ←
          </button>
          <h1>
            <span>What are you looking for?</span>
          </h1>
        </header>
        <MobileOnboardingProgress step={4} />
        <p className="m-lead">A few preferences help Odesseus.ai keep every match relevant.</p>

        <form onSubmit={finishSetup} className="m-signup-form">
          <label className="m-field">
            <span>Target role</span>
            <input
              className="m-input"
              value={targetRole}
              onChange={(event) => setTargetRole(event.target.value)}
              placeholder="Senior Compliance Analyst"
            />
          </label>
          <label className="m-field">
            <span>Location</span>
            <input
              className="m-input"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="Remote or Houston, TX"
            />
          </label>
          <label className="m-field">
            <span>Work style</span>
            <select
              className="m-input"
              value={workPreference}
              onChange={(event) => setWorkPreference(event.target.value)}
            >
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
              <option value="flexible">Flexible</option>
            </select>
          </label>
          <label className="m-field">
            <span>Minimum salary</span>
            <input
              className="m-input"
              type="number"
              min="0"
              value={minimumSalary}
              onChange={(event) => setMinimumSalary(event.target.value)}
              placeholder="120,000"
            />
          </label>
          {error ? <p className="m-inline-error">{error}</p> : null}
          <button className="m-action" disabled={busy} type="submit">
            {busy ? "Setting up Odesseus…" : "Finish Setup"}
          </button>
        </form>
        <p className="m-note">You can update these anytime in Settings.</p>
      </main>
    );
  }

  return (
    <main className="odesseus-mobile-only m-screen m-screen-03">
      <header className="m-screen-header">
        <h1>
          <span>Start with your resume.</span>
        </h1>
      </header>
      <MobileOnboardingProgress step={3} />
      <p className="m-lead">
        Upload the resume you already use. Odesseus improves it for a specific job — it
        does not create one from scratch.
      </p>

      <form onSubmit={continueToPreferences} className="m-signup-form">
        <label className="m-upload-area">
          <span className="m-upload-icon" aria-hidden="true">
            ↑
          </span>
          <strong>Upload your resume</strong>
          <span className="m-upload-hint">PDF or DOCX</span>
          <input
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            hidden
          />
          {file ? <span className="m-upload-filename">{file.name}</span> : null}
        </label>
        {error ? <p className="m-inline-error">{error}</p> : null}
        <button className="m-action" disabled={busy} type="submit">
          {busy ? "Uploading…" : "Upload Resume →"}
        </button>
      </form>
      <p className="m-note">
        🔒 Your resume stays private — used only to power your matches.
      </p>
    </main>
  );
}
