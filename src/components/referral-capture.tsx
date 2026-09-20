"use client";

import { useEffect } from "react";

export default function ReferralCapture() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("ref");
    if (!code) return;

    fetch("/api/referrals/capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, landingPath: url.pathname }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  return null;
}
