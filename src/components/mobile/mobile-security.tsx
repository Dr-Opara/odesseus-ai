"use client";

import { useState } from "react";
import MobileScreen from "@/components/mobile/mobile-screen";
import MobileIconRow from "@/components/mobile/mobile-icon-row";
import PasswordChangeForm from "@/components/password-change-form";

/**
 * Mobile Password & Security (screen 15).
 *
 * "Change Password" reuses the real PasswordChangeForm (same Supabase auth
 * call as desktop) expanded inline. "Google Account" reflects the signed-in
 * user's real linked-identity state. The remaining rows (Two-Step
 * Verification, Active Sessions, Sign Out Everywhere) have no backend yet —
 * per instruction they render as visually correct, non-destructive
 * placeholders rather than fabricated functionality.
 *
 * BACKEND TODO (Phase 5): two-factor auth, session listing/revocation.
 */
export default function MobileSecurity({ googleConnected }: { googleConnected: boolean }) {
  const [changingPassword, setChangingPassword] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <MobileScreen index="15" title="Password & Security" lead="Protect your Odesseus account.">
      <div className="m-list" style={{ marginBottom: 18 }}>
        {changingPassword ? (
          <div className="m-card" style={{ display: "block" }}>
            <strong style={{ fontSize: 13 }}>Change Password</strong>
            <div style={{ marginTop: 10 }}>
              <PasswordChangeForm />
            </div>
            <button
              type="button"
              className="m-secondary-link"
              style={{ marginTop: 10, background: "none", border: 0, cursor: "pointer" }}
              onClick={() => setChangingPassword(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <MobileIconRow
            icon="🔑"
            color="purple"
            title="Change Password"
            sub="Update your account password"
            onClick={() => setChangingPassword(true)}
          />
        )}

        <MobileIconRow
          icon="🔗"
          color="teal"
          title="Google Account"
          sub={googleConnected ? "Connected sign-in" : "Not connected"}
          right={
            googleConnected ? (
              <b style={{ color: "#26cc7a", fontSize: 9.5, fontWeight: 600 }}>Connected</b>
            ) : (
              <b className="m-chevron">›</b>
            )
          }
        />

        <MobileIconRow
          icon="🛡"
          color="green"
          title="Two-Step Verification"
          sub="Add another layer of protection"
          onClick={() => setNotice("Two-step verification is coming in a future update.")}
        />
        <MobileIconRow
          icon="💻"
          color="red"
          title="Active Sessions"
          sub="Review signed-in devices"
          onClick={() => setNotice("Session review is coming in a future update.")}
        />
        <MobileIconRow
          icon="🚪"
          color="pink"
          title="Sign Out Everywhere"
          sub="End all other sessions"
          onClick={() => setNotice("This will be available in a future update.")}
        />
      </div>

      {notice ? <div className="m-note" style={{ marginBottom: 14 }}>{notice}</div> : null}

      <p className="m-eyebrow" style={{ margin: "4px 4px 8px" }}>
        SECURITY
      </p>
      <div className="m-note-card m-card" style={{ display: "block" }}>
        <strong style={{ fontSize: 14 }}>Security activity</strong>
        <p className="muted" style={{ marginTop: 6 }}>
          We’ll alert you when important sign-in or account security changes occur.
        </p>
      </div>
    </MobileScreen>
  );
}
