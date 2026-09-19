"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function PasswordChangeForm() {
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password.length < 8) {
      setStatus("Use at least 8 characters.");
      return;
    }

    if (password !== confirm) {
      setStatus("Passwords do not match.");
      return;
    }

    setStatus("Saving…");
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setStatus(error.message);
      return;
    }

    setPassword("");
    setConfirm("");
    setStatus("Password updated.");
  }

  return (
    <form className="card" style={{ padding: 26 }} onSubmit={save}>
      <div className="muted" style={{ fontSize: 13 }}>Security</div>
      <h2 style={{ fontSize: 22, margin: "7px 0 16px" }}>Change password</h2>

      <div style={{ display: "grid", gap: 14 }}>
        <label className="field-label">
          New password
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
          />
        </label>
        <label className="field-label">
          Confirm new password
          <input
            className="input"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={8}
          />
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 20 }}>
        <button className="btn btn-primary" type="submit">Update password</button>
        {status ? <span className="muted" style={{ fontSize: 14 }}>{status}</span> : null}
      </div>
    </form>
  );
}
