import Link from "next/link";
import MobileScreen from "@/components/mobile/mobile-screen";
import MobileIconRow, { type IconColor } from "@/components/mobile/mobile-icon-row";

function initials(name?: string | null) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

const MENU = [
  ["🎯", "green", "Job Preferences", "/settings/job-preferences"],
  ["📄", "olive", "Documents", "/settings/documents"],
  ["$", "purple", "Pricing", "/pricing"],
  ["⚙", "navy", "Account Settings", "/settings"],
  ["🔔", "orange", "Notifications", "/settings/notifications"],
  ["🎁", "teal", "Refer a Friend", "/settings/referrals"],
  ["⚖", "cyan", "Legal", "/legal"],
  ["❓", "red", "Help & Support", "/support"],
] as const satisfies readonly (readonly [string, IconColor, string, string])[];

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
        {MENU.map(([icon, color, title, href]) => (
          <MobileIconRow key={href} icon={icon} color={color} title={title} href={href} />
        ))}
      </div>
    </MobileScreen>
  );
}
