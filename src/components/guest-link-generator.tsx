"use client";

import { useState } from "react";

/**
 * Owner-side Guest Live link generation (F2).
 *
 * The Share Annual owner mints a secure link and shares it manually: there is
 * no guest account, no guest login, no guest email invite, and no guest slot
 * accounting. The raw token is returned exactly once, by the backend, and is
 * never logged.
 */
export default function GuestLinkGenerator() {
  const [status, setStatus] = useState<"idle" | "working" | "ready" | "failed">("idle");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reason, setReason] = useState("");

  async function generate() {
    setStatus("working");
    setReason("");
    setCopied(false);
    try {
      const response = await fetch("/api/live/guest-links", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as { token?: string; error?: string } | null;
      if (!response.ok || !payload?.token) {
        setReason(payload?.error ?? "Odesseus could not create that guest link.");
        setStatus("failed");
        return;
      }
      const url = `${window.location.origin}/live/guest/${payload.token}`;
      setLink(url);
      setStatus("ready");
    } catch {
      setReason("Odesseus could not reach the Live service.");
      setStatus("failed");
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
      setReason("Copy it manually from the link above.");
    }
  }

  return (
    <div className="card" style={{ padding: 24, marginTop: 24 }}>
      <div className="muted" style={{ fontSize: 13 }}>
        Guest Live
      </div>
      <h2 style={{ fontSize: 22, margin: "6px 0 8px" }}>Share Live with a guest</h2>
      <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
        Create a secure Guest Live access link and send it to your guest yourself. Your
        guest opens it in their browser — no account, no login, no payment, and nothing
        from your own profile, resume, applications, or billing is shared.
      </p>

      {link ? (
        <div style={{ marginTop: 18 }}>
          <label className="muted" style={{ fontSize: 13, display: "block", marginBottom: 6 }}>
            Guest link (shown once)
          </label>
          <input
            className="input"
            readOnly
            value={link}
            onFocus={(event) => event.currentTarget.select()}
            style={{ width: "100%", wordBreak: "break-all" }}
          />
          <div className="emp-page-actions" style={{ marginTop: 14 }}>
            <button className="btn btn-primary" type="button" onClick={copy}>
              {copied ? "Link copied" : "Copy link"}
            </button>
            <a className="btn btn-secondary" href={link} target="_blank" rel="noreferrer">
              Open guest view
            </a>
          </div>
        </div>
      ) : null}

      {status === "failed" ? (
        <p className="apply-error" style={{ marginTop: 16 }}>
          {reason}
        </p>
      ) : null}

      <button
        className="figma-btn figma-btn-orange"
        type="button"
        style={{ marginTop: 18 }}
        onClick={generate}
        disabled={status === "working"}
      >
        {status === "working" ? "Creating…" : link ? "Create another link" : "Generate guest link"}
      </button>
    </div>
  );
}
