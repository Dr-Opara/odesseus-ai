"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function PartnerContentForm({
  campaigns,
}: {
  campaigns: Array<{ id: string; title: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);

    const response = await fetch("/api/partners/content", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        campaignId: String(form.get("campaign_id") || "") || null,
        platform: String(form.get("platform") || ""),
        contentUrl: String(form.get("content_url") || ""),
        postedAt: null,
        notes: String(form.get("notes") || "") || null,
      }),
    });

    const data = await response.json();
    if (response.ok) {
      event.currentTarget.reset();
      setMessage("Content submitted for review.");
      router.refresh();
    } else {
      setMessage(data.error || "Could not submit content.");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="partner-content-form">
      <select className="input" name="campaign_id" defaultValue="">
        <option value="">No campaign / organic content</option>
        {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.title}</option>)}
      </select>
      <select className="input" name="platform" defaultValue="instagram">
        <option value="instagram">Instagram</option>
        <option value="facebook">Facebook</option>
        <option value="tiktok">TikTok</option>
      </select>
      <input className="input" name="content_url" type="url" placeholder="Post or video URL" required />
      <textarea className="input" name="notes" rows={3} placeholder="Notes (optional)" />
      <button className="btn btn-primary" disabled={busy}>{busy ? "Submitting…" : "Submit content"}</button>
      {message ? <span className="muted">{message}</span> : null}
    </form>
  );
}
