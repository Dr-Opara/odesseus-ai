import MobileScreen from "@/components/mobile/mobile-screen";
import MobileIconRow, { type IconColor } from "@/components/mobile/mobile-icon-row";

const ACCOUNT_ROWS = [
  ["👤", "cyan", "Personal Information", "Name and email", "/profile"],
  ["🔒", "purple", "Password & Security", "Password and sign-in security", "/settings/security"],
] as const;

const PREFERENCE_ROWS = [
  ["🔔", "orange", "Notifications", "Applications, interviews, documents", "/settings/notifications"],
  ["🎯", "green", "Job Preferences", "Roles, salary, location, work type", "/settings/job-preferences"],
  ["📄", "olive", "Documents", "Resume and career documents", "/settings/documents"],
  ["🌐", "pink", "Language & Region", "Language, country and timezone", "/settings/language-region"],
  ["🌓", "navy", "Appearance", "Light, dark or system", "/settings/appearance"],
  ["🎁", "teal", "Refer a Friend", "Invite friends, earn rewards", "/settings/referrals"],
] as const satisfies readonly (readonly [string, IconColor, string, string, string])[];

/**
 * Mobile Account Settings (screen 14) — grouped settings menu. Rows link to
 * the real settings sub-pages, sharing the same circular icon-row pattern
 * (MobileIconRow) used across screens 15/16/17/19/20/21/33.
 */
export default function MobileSettings() {
  return (
    <MobileScreen index="14" title="Account Settings" lead="Manage your account and app experience." nav>
      <p className="m-eyebrow" style={{ margin: "4px 4px 8px" }}>
        ACCOUNT
      </p>
      <div className="m-list" style={{ marginBottom: 18 }}>
        {ACCOUNT_ROWS.map((row) => (
          <MobileIconRow key={row[4]} icon={row[0]} color={row[1]} title={row[2]} sub={row[3]} href={row[4]} />
        ))}
      </div>

      <p className="m-eyebrow" style={{ margin: "4px 4px 8px" }}>
        PREFERENCES
      </p>
      <div className="m-list">
        {PREFERENCE_ROWS.map((row) => (
          <MobileIconRow key={row[4]} icon={row[0]} color={row[1]} title={row[2]} sub={row[3]} href={row[4]} />
        ))}
      </div>
    </MobileScreen>
  );
}
