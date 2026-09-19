"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function FollowUpEditor({
  draft,
}: {
  draft: {
    id: string;
    recipient_email: string | null;
    recipient_name: string | null;
    subject: string;
    body: string;
    status: string;
    sent_at: string | null;
    send_provider: string | null;
    last_error: string | null;
  };
}) {
  const router = useRouter();
  const [recipientEmail, setRecipientEmail] = useState(
    draft.recipient_email || ""
  );
  const [recipientName, setRecipientName] = useState(
    draft.recipient_name || ""
  );
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [status, setStatus] = useState(draft.status);
  const [busy, setBusy] = useState<"save" | "approve" | "send" | null>(null);
  const [message, setMessage] = useState("");

  async function save(nextStatus: "draft" | "approved") {
    setBusy(nextStatus === "approved" ? "approve" : "save");
    setMessage("");

    const response = await fetch(`/api/follow-ups/${draft.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipientEmail: recipientEmail.trim() || null,
        recipientName: recipientName.trim() || null,
        subject,
        body,
        status: nextStatus,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error || "Odysseus could not save the follow-up.");
      setBusy(null);
      return false;
    }

    setStatus(nextStatus);
    setMessage(nextStatus === "approved" ? "Approved" : "Saved");
    setBusy(null);
    router.refresh();
    return true;
  }

  async function send() {
    if (status !== "approved") {
      const approved = await save("approved");
      if (!approved) return;
    }

    setBusy("send");
    setMessage("");

    const response = await fetch(
      `/api/follow-ups/${draft.id}/send`,
      { method: "POST" }
    );

    const data = await response.json();

    if (response.ok && data.sent) {
      setMessage(
        data.provider
          ? `Sent with ${data.provider}.`
          : "Follow-up sent."
      );
      setBusy(null);
      router.refresh();
      return;
    }

    if (response.ok && data.mailto) {
      setMessage("Opening your email app with the approved draft.");
      setBusy(null);
      window.location.href = data.mailto;
      return;
    }

    if (data.fallback) {
      setMessage(
        "Direct sending was unavailable. Opening the approved draft in your email app."
      );
      setBusy(null);
      window.location.href = data.fallback;
      return;
    }

    setMessage(data.error || "Odysseus could not send the follow-up.");
    setBusy(null);
  }

  if (draft.sent_at) {
    return (
      <div className="card followup-editor">
        <div className="badge">Sent</div>
        <h2 style={{ fontSize: 24, margin: "14px 0 5px" }}>
          Follow-up sent.
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          {new Date(draft.sent_at).toLocaleString()}
          {draft.send_provider ? ` · ${draft.send_provider}` : ""}
        </p>
      </div>
    );
  }

  return (
    <form
      className="card followup-editor"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void save("draft");
      }}
    >
      <div>
        <div className="muted" style={{ fontSize: 13 }}>
          Follow-up
        </div>
        <h2 style={{ fontSize: 24, margin: "7px 0 6px" }}>
          Review before anything is sent.
        </h2>
        <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
          Edit the draft so it sounds like you and confirms only what actually happened.
        </p>
      </div>

      <div className="followup-recipient-grid">
        <label className="field-label">
          Recipient
          <input
            className="input"
            type="email"
            value={recipientEmail}
            onChange={(event) => setRecipientEmail(event.target.value)}
            placeholder="interviewer@example.com"
          />
        </label>

        <label className="field-label">
          Name <span className="muted">(optional)</span>
          <input
            className="input"
            value={recipientName}
            onChange={(event) => setRecipientName(event.target.value)}
            placeholder="Interviewer name"
          />
        </label>
      </div>

      <label className="field-label">
        Subject
        <input
          className="input"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          required
        />
      </label>

      <label className="field-label">
        Message
        <textarea
          className="input followup-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          required
        />
      </label>

      {draft.last_error ? (
        <div className="review-note">
          Last send issue: {draft.last_error}
        </div>
      ) : null}

      {message ? (
        <div className="muted" style={{ fontSize: 13 }}>
          {message}
        </div>
      ) : null}

      <div className="followup-actions">
        <button className="btn btn-secondary" type="submit" disabled={Boolean(busy)}>
          {busy === "save" ? "Saving…" : "Save draft"}
        </button>

        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => void save("approved")}
          disabled={Boolean(busy)}
        >
          {busy === "approve" ? "Approving…" : status === "approved" ? "Approved ✓" : "Approve"}
        </button>

        <button
          className="btn btn-primary"
          type="button"
          onClick={() => void send()}
          disabled={Boolean(busy) || !recipientEmail.trim()}
        >
          {busy === "send" ? "Sending…" : "Approve & send"}
        </button>
      </div>
    </form>
  );
}
