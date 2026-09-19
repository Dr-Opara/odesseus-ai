"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TailorButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function tailor() {
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || "Odysseus could not tailor your resume.");

      router.push(`/resume-tailoring/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn btn-primary" onClick={tailor} disabled={busy}>
        {busy ? "Tailoring resume…" : "Tailor my resume"}
      </button>
      {error ? <div style={{ marginTop: 10, fontSize: 13, color: "#a33a2b" }}>{error}</div> : null}
    </div>
  );
}
