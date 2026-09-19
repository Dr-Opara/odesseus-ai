"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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

    if (!file) {
      setError("Choose your resume to continue.");
      return;
    }

    if (!["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(file.type)) {
      setError("Use a PDF or DOCX resume.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError("Your resume must be 10 MB or smaller.");
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

    const extension = file.name.split(".").pop()?.toLowerCase() || "pdf";
    const path = `${user.id}/master-${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("resumes")
      .upload(path, file, { upsert: false });

    if (uploadError) {
      setError(uploadError.message);
      setBusy(false);
      return;
    }

    const { error: resumeError } = await supabase.from("resumes").insert({
      user_id: user.id,
      file_name: file.name,
      storage_path: path,
      mime_type: file.type,
      size_bytes: file.size,
      is_master: true,
      is_approved: true,
    });

    if (resumeError) {
      await supabase.storage.from("resumes").remove([path]);
      setError(resumeError.message);
      setBusy(false);
      return;
    }

    const profileResult = await supabase.from("profiles").upsert({
      id: user.id,
      full_name: fullName || user.user_metadata?.full_name || null,
      location: location || null,
      work_preference: workPreference,
      onboarding_completed: true,
    });

    const preferenceResult = await supabase.from("job_preferences").upsert({
      user_id: user.id,
      target_titles: targetRole ? [targetRole] : [],
      target_locations: location ? [location] : [],
      remote_only: workPreference === "remote",
      minimum_salary: minimumSalary ? Number(minimumSalary) : null,
      min_match_score: 85,
    });

    if (profileResult.error || preferenceResult.error) {
      setError(profileResult.error?.message || preferenceResult.error?.message || "Could not save your profile.");
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
          {busy ? "Setting up Odysseus…" : "Continue"}
        </button>
      </div>
    </form>
  );
}
