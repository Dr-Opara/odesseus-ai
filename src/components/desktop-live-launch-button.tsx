"use client";

import { useState } from "react";

type LaunchResponse = {
  launchUrl?: string;
  expiresAt?: string;
  error?: string;
};

export default function DesktopLiveLaunchButton({
  interviewId,
}: {
  interviewId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function launch() {
    if (busy) return;

    setBusy(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/interviews/${interviewId}/live/desktop-launch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      const payload = (await response.json().catch(() => ({}))) as LaunchResponse;

      if (!response.ok || !payload.launchUrl) {
        throw new Error(payload.error || "Odesseus could not launch the Windows companion.");
      }

      setMessage("Opening Odesseus Live…");
      window.location.assign(payload.launchUrl);

      // Browsers do not provide a reliable success callback for custom
      // protocols. Leave a useful recovery hint instead of claiming success.
      window.setTimeout(() => {
        setBusy(false);
        setMessage(
          "If Odesseus Live did not open, install or start the Windows companion and try again."
        );
      }, 1800);
    } catch (error) {
      setBusy(false);
      setMessage(
        error instanceof Error
          ? error.message
          : "Odesseus could not launch the Windows companion."
      );
    }
  }

  return (
    <div className="desktop-live-launch">
      <button
        type="button"
        className="btn btn-primary"
        onClick={launch}
        disabled={busy}
      >
        {busy ? "Opening Odesseus Live…" : "Start Odesseus Live"}
      </button>
      {message ? (
        <p className="muted" style={{ margin: "9px 0 0", fontSize: 12, lineHeight: 1.45 }}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
