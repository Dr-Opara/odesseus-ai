"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TailoringActions({
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
      setError(data.error || "Odysseus could not approve this resume.");
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
      setError(data.error || "Odysseus could not create another version.");
      setBusy(null);
      return;
    }

    router.push(`/resume-tailoring/${data.id}`);
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={approve} disabled={approved || busy !== null}>
          {approved ? "Approved ✓" : busy === "approve" ? "Approving…" : "Approve resume"}
        </button>
        <button className="btn btn-secondary" onClick={regenerate} disabled={busy !== null}>
          {busy === "regenerate" ? "Creating version…" : "Regenerate"}
        </button>
      </div>
      {error ? <div style={{ marginTop: 10, fontSize: 13, color: "#a33a2b" }}>{error}</div> : null}
    </div>
  );
}
