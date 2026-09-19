"use client";

import { useState } from "react";
import { deleteAccount } from "@/app/actions/account";

export default function DeleteAccountForm() {
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  if (!confirming) {
    return (
      <button
        type="button"
        className="account-menu-logout"
        style={{ width: "auto", padding: "10px 16px", border: "1px solid var(--line)" }}
        onClick={() => setConfirming(true)}
      >
        Delete account
      </button>
    );
  }

  return (
    <form action={deleteAccount} style={{ display: "grid", gap: 10, maxWidth: 380 }}>
      <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>
        This permanently deletes your account, resumes, applications, interviews, and all
        associated data. This cannot be undone. Type <strong>DELETE</strong> to confirm.
      </p>
      <input
        className="input"
        name="confirmation"
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
        placeholder="Type DELETE"
        autoComplete="off"
      />
      <div style={{ display: "flex", gap: 10 }}>
        <button
          type="submit"
          className="account-menu-logout"
          style={{ width: "auto", padding: "10px 16px", border: "1px solid var(--line)" }}
          disabled={confirmation !== "DELETE"}
        >
          Permanently delete my account
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setConfirming(false);
            setConfirmation("");
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
