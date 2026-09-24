"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  saveProfileAndPreferences,
  uploadMasterResume,
  validateResumeFile,
} from "@/lib/onboarding/submit";

export default function OnboardingForm({ fullName }: { fullName?: string | null }) {
  const router = useRouter();
  const supabase = createClient();
  const [file, setFile] = useState<File | null>(null);
  const [targetRole, setTargetRole] = useState("");
  const [location, setLocation] = useState("");
  const [minimumSalary, setMinimumSalary] = useState("");
  const [workPreference, setWorkPreference] = useState("remote");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const validationError = validateResumeFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy(true);

    const { data: authData, error: authError } = await supabase.auth.getUser();
    const user = authData.user;

    if (authError || !user) {
      setBusy(false);
      router.push("/login");
      return;
    }

    const uploadResult = await uploadMasterResume(supabase, user.id, file!);
    if (uploadResult.error) {
      setError(uploadResult.error);
      setBusy(false);
      return;
    }

    const saveResult = await saveProfileAndPreferences(supabase, user.id, {
      fullName: fullName || user.user_metadata?.full_name || null,
      targetRole,
      location,
      workPreference,
      minimumSalary,
    });

    if (saveResult.error) {
      setError(saveResult.error);
      setBusy(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={submit}>
      <div className="card" style={{ padding: 34, marginTop: 34 }}>
        <label style={{ display: "grid", gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Resume</span>
          <input
            className="input"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            required
          />
        </label>
        <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>PDF or DOCX · up to 10 MB · private to your account</p>
      </div>

      <div className="card" style={{ padding: 24, marginTop: 18 }}>
        <h3 style={{ margin: "0 0 16px" }}>What are you looking for?</h3>
        <div style={{ display: "grid", gap: 14 }}>
          <input className="input" value={targetRole} onChange={(e) => setTargetRole(e.target.value)} required placeholder="Target role, e.g. GRC Manager" />
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location, e.g. Remote or Houston, TX" />
          <select className="input" value={workPreference} onChange={(e) => setWorkPreference(e.target.value)}>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">On-site</option>
            <option value="flexible">Flexible</option>
          </select>
          <input className="input" type="number" min="0" value={minimumSalary} onChange={(e) => setMinimumSalary(e.target.value)} placeholder="Minimum salary, optional" />
        </div>
      </div>

      {error ? <div style={{ marginTop: 16, padding: 12, borderRadius: 12, background: "#fff1ef", fontSize: 14 }}>{error}</div> : null}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 22 }}>
        <button className="btn btn-primary" disabled={busy} type="submit">
          {busy ? "Setting up Odesseus…" : "Continue"}
        </button>
      </div>
    </form>
  );
}
