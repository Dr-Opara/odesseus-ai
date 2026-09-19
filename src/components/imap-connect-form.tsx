"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function ImapConnectForm({
  provider,
}: {
  provider: "icloud" | "imap";
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [secret, setSecret] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("993");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const response = await fetch("/api/integrations/imap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        email,
        secret,
        host,
        port: Number(port),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      setError(data.error || "Odysseus could not connect this mailbox.");
      setBusy(false);
      return;
    }

    setSecret("");
    setBusy(false);
    router.refresh();
  }

  return (
    <form className="integration-connect-form" onSubmit={submit}>
      <input
        className="input"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder={provider === "icloud" ? "you@icloud.com" : "you@example.com"}
        required
      />

      {provider === "imap" ? (
        <div className="integration-imap-grid">
          <input
            className="input"
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="IMAP host"
            required
          />
          <input
            className="input"
            value={port}
            onChange={(event) => setPort(event.target.value)}
            inputMode="numeric"
            placeholder="993"
            required
          />
        </div>
      ) : null}

      <input
        className="input"
        type="password"
        value={secret}
        onChange={(event) => setSecret(event.target.value)}
        placeholder={
          provider === "icloud"
            ? "Apple app-specific password"
            : "Mail app password / IMAP password"
        }
        required
      />

      {error ? <div className="apply-error">{error}</div> : null}

      <button className="btn btn-secondary" type="submit" disabled={busy}>
        {busy ? "Connecting…" : "Connect"}
      </button>
    </form>
  );
}
