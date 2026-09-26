"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Mobile-styled approve / regenerate actions for the Resume Review screen.
 * Uses the exact same routes as the desktop `TailoringActions`: POST to
 * `/api/tailor/[id]/approve` to freeze a version, POST to `/api/tailor` to
 * create another version. No resume content is generated here — the APIs
 * own the tailoring and approval logic.
 */
export default function MobileTailoringActions({
  tailoringId,
  jobId,
  approved,
}: {
  tailoringId: string;
  jobId: string;
  approved: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "regenerate" | null>(null);
  const [error, setError] = useState("");

  async function approve() {
    setBusy("approve");
    setError("");
    const response = await fetch(`/api/tailor/${tailoringId}/approve`, { method: "POST" });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error || "Odesseus could not approve this resume.");
      setBusy(null);
      return;
    }

    router.refresh();
  }

  async function regenerate() {
    setBusy("regenerate");
    setError("");
    const response = await fetch("/api/tailor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error || "Odesseus could not create another version.");
      setBusy(null);
      return;
    }

    router.push(`/resume-tailoring/${data.id}`);
  }

  return (
    <div className="m-actions">
      <button className="m-btn-primary" onClick={approve} disabled={approved || busy !== null}>
        {approved ? "Approved ✓" : busy === "approve" ? "Approving…" : "Approve resume"}
      </button>
      <button className="m-btn-ghost" onClick={regenerate} disabled={busy !== null}>
        {busy === "regenerate" ? "Creating version…" : "Regenerate"}
      </button>
      {error ? <div className="m-inline-error">{error}</div> : null}
    </div>
  );
}