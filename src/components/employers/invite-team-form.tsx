"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inviteTeamMember } from "@/lib/employers/team-adapter";
import EmployerStatePanel from "@/components/employers/state-panel";
import type { TeamMemberRole } from "@/lib/employers/types";

/**
 * Invite a teammate (F13-M). The invitation row and its email are the
 * backend's; the frontend creates no membership and grants no seat. When the
 * backend could not deliver the email, the redemption link it returned is
 * shown so the admin can still pass the invitation on.
 */
export default function InviteTeamForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<TeamMemberRole, "Owner">>("Recruiter");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");
    setMessage("");
    setLink(null);

    const result = await inviteTeamMember(orgId, email.trim(), role);
    if (result.status === "unavailable") {
      setMessage(result.reason);
      setStatus("failed");
      return;
    }
    setStatus("sent");
    setMessage(
      result.data.emailed
        ? `Invitation sent to ${email.trim()}.`
        : "Invitation created, but the email could not be delivered. Share the link below instead."
    );
    setLink(result.data.redemptionLink ?? null);
    setEmail("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 28 }}>
      <strong>Invite a teammate</strong>
      <div className="emp-row-list" style={{ marginTop: 12 }}>
        <div className="emp-row">
          <span className="emp-row-label">Work email</span>
          <input
            className="input"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="recruiter@company.com"
            style={{ maxWidth: 320 }}
          />
        </div>
        <div className="emp-row">
          <span className="emp-row-label">Role</span>
          <select
            className="input"
            value={role}
            onChange={(event) => setRole(event.target.value as Exclude<TeamMemberRole, "Owner">)}
            style={{ maxWidth: 200 }}
          >
            <option value="Admin">Admin</option>
            <option value="Recruiter">Recruiter</option>
            <option value="Viewer">Viewer</option>
          </select>
        </div>
      </div>

      {status === "failed" || status === "sent" ? (
        <div style={{ marginTop: 16 }}>
          <EmployerStatePanel
            kind={status === "failed" ? "error" : "empty"}
            title={status === "failed" ? "We couldn't send that invitation" : "Invitation created"}
            message={message}
          />
        </div>
      ) : null}

      {link ? (
        <p className="muted" style={{ marginTop: 12, fontSize: 13, wordBreak: "break-all" }}>
          Invitation link: {link}
        </p>
      ) : null}

      <button className="figma-btn figma-btn-orange" type="submit" style={{ marginTop: 18 }} disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : "Send Invitation"}
      </button>
    </form>
  );
}
