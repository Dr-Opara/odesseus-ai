"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inviteTeamMemberAction } from "@/lib/employers/actions";
import EmployerStatePanel from "@/components/employers/state-panel";

/**
 * Invites a teammate (F13-M).
 *
 * The invitation is created by the backend, which is admin/owner-gated and
 * rate-limited. This component sends the address and role and re-reads the
 * page afterwards; it never adds the person to the roster itself, because
 * membership is server-owned.
 */
export default function InviteTeamMemberForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setFailure(null);
    setSent(false);

    const result = await inviteTeamMemberAction(
      orgId,
      String(formData.get("email") || ""),
      String(formData.get("role") || "Recruiter") as "Admin" | "Recruiter"
    );

    setPending(false);

    if (result.status === "unavailable") {
      setFailure(result.reason);
      return;
    }

    setSent(true);
    // The invitation is a real row now; re-read so the pending list shows it.
    router.refresh();
  }

  return (
    <form action={handleSubmit}>
      <h2 style={{ fontSize: 18, margin: "0 0 10px" }}>Invite a teammate</h2>
      <div className="emp-page-actions">
        <input
          className="input"
          type="email"
          name="email"
          required
          placeholder="teammate@company.com"
          aria-label="Teammate email"
          style={{ minWidth: 280 }}
        />
        <select className="input" name="role" defaultValue="Recruiter" aria-label="Role">
          <option>Recruiter</option>
          <option>Admin</option>
        </select>
        <button className="figma-btn figma-btn-orange" type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send invitation"}
        </button>
      </div>
      {sent ? (
        <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
          Invitation sent. It appears below until it is accepted.
        </p>
      ) : null}
      {failure ? (
        <div style={{ marginTop: 16 }}>
          <EmployerStatePanel
            kind="error"
            title="Could not send that invitation"
            message={failure}
          />
        </div>
      ) : null}
    </form>
  );
}
