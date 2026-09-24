"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Mobile CTA that starts the resume tailoring flow for a real job. Uses the
 * same server route as the desktop control (`POST /api/tailor`) and routes to
 * the shared review page, so the optimization workflow is identical on both
 * surfaces.
 */
export default function MobileTailorButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function tailor() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Odesseus could not tailor your resume.");
      }
      router.push(`/resume-tailoring/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        className="m-action"
        onClick={tailor}
        disabled={busy}
      >
        {busy ? "Tailoring resume…" : "Tailor my resume"}
      </button>
      {error ? <p className="m-inline-error">{error}</p> : null}
    </div>
  );
}