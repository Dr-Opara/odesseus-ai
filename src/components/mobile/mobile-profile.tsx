import Link from "next/link";
import MobileScreen from "@/components/mobile/mobile-screen";

function initials(name?: string | null) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

const MENU = [
  ["🎯", "Job Preferences", "/settings/job-preferences"],
  ["📄", "Documents", "/settings/documents"],
  ["$", "Pricing", "/pricing"],
  ["⚙", "Account Settings", "/settings"],
  ["🔔", "Notifications", "/settings/notifications"],
  ["🎁", "Refer a Friend", "/settings/referrals"],
  ["⚖", "Legal", "/legal"],
  ["❓", "Help & Support", "/support"],
] as const;

/**
 * Mobile Profile screen (screen 12) — the candidate's own verified name,
 * email and live application/interview/saved-job counts, plus the same
 * settings destinations the desktop account menu links to.
 */
export default function MobileProfile({
  fullName,
  email,
  applicationCount,
  interviewCount,
  savedJobCount,
}: {
  fullName: string | null;
  email: string | null;
  applicationCount: number;
  interviewCount: number;
  savedJobCount: number;
}) {
  return (
    <MobileScreen
      index="12"
      title={fullName || "Your profile"}
      right={
        <Link href="/settings" aria-label="Settings">
          ⚙
        </Link>
      }
      nav
    >
      <div className="m-profile-header">
        <span className="m-avatar">{initials(fullName)}</span>
        <div>
          <strong>{fullName || "Your account"}</strong>
          {email ? <small>{email}</small> : null}
        </div>
      </div>

      <div className="m-stat-row">
        <div>
          <strong>{applicationCount}</strong>
          <span>Applications</span>
        </div>
        <div>
          <strong>{interviewCount}</strong>
          <span>Interviews</span>
        </div>
        <div>
          <strong>{savedJobCount}</strong>
          <span>Saved Jobs</span>
        </div>
      </div>

      <div className="m-list">
        {MENU.map(([icon, title, href]) => (
          <Link className="m-card" href={href} key={title}>
            <span className="m-icon">{icon}</span>
            <span className="m-copy">
              <strong>{title}</strong>
            </span>
            <b className="m-chevron">›</b>
          </Link>
        ))}
      </div>
    </MobileScreen>
  );
}
