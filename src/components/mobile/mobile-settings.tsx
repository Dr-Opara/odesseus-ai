import Link from "next/link";
import MobileScreen from "@/components/mobile/mobile-screen";

const ACCOUNT_ROWS = [
  ["👤", "Personal Information", "Name and email", "/profile"],
  ["🔒", "Password & Security", "Password and sign-in security", "/settings/security"],
] as const;

const PREFERENCE_ROWS = [
  ["🔔", "Notifications", "Applications, interviews, documents", "/settings/notifications"],
  ["🎯", "Job Preferences", "Roles, salary, location, work type", "/settings/job-preferences"],
  ["📄", "Documents", "Resume and career documents", "/settings/documents"],
  ["🌐", "Language & Region", "Language, country and timezone", "/settings/language-region"],
  ["🌓", "Appearance", "Light, dark or system", "/settings/appearance"],
  ["🎁", "Refer a Friend", "Invite friends, earn rewards", "/settings/referrals"],
] as const;

function Row({ icon, title, sub, href }: { icon: string; title: string; sub: string; href: string }) {
  return (
    <Link className="m-card" href={href}>
      <span className="m-icon">{icon}</span>
      <span className="m-copy">
        <strong>{title}</strong>
        <small>{sub}</small>
      </span>
      <b className="m-chevron">›</b>
    </Link>
  );
}

/**
 * Mobile Account Settings (screen 14) — grouped settings menu. Rows link to
 * the real settings sub-pages; screens without a dedicated route yet
 * (Password & Security, Notifications, Appearance, Refer a Friend) still
 * link somewhere real once those routes land, and are excluded from
 * `wired` screens in the meantime rather than faked here.
 */
export default function MobileSettings() {
  return (
    <MobileScreen index="14" title="Account Settings" lead="Manage your account and app experience." nav>
      <p className="m-eyebrow" style={{ margin: "4px 4px 8px" }}>
        ACCOUNT
      </p>
      <div className="m-list" style={{ marginBottom: 18 }}>
        {ACCOUNT_ROWS.map((row) => (
          <Row key={row[3]} icon={row[0]} title={row[1]} sub={row[2]} href={row[3]} />
        ))}
      </div>

      <p className="m-eyebrow" style={{ margin: "4px 4px 8px" }}>
        PREFERENCES
      </p>
      <div className="m-list">
        {PREFERENCE_ROWS.map((row) => (
          <Row key={row[3]} icon={row[0]} title={row[1]} sub={row[2]} href={row[3]} />
        ))}
      </div>
    </MobileScreen>
  );
}
