import Link from "next/link";
import { logout } from "@/app/login/actions";

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || "there";
}

export default function AppShell({
  fullName,
  applicationCredits,
  interviewPasses,
  active,
  children,
}: {
  fullName?: string | null;
  applicationCredits: number;
  interviewPasses: number;
  active?: "home" | "jobs" | "applications" | "interviews" | "profile";
  children: React.ReactNode;
}) {
  const nav = [
    ["home", "/dashboard", "Home"],
    ["jobs", "/jobs", "Jobs"],
    ["applications", "/applications", "Applications"],
    ["interviews", "/interviews", "Interviews"],
    ["profile", "/profile", "Profile"],
  ] as const;

  return (
    <main className="app-surface">
      <header className="app-header">
        <div className="shell app-header-inner">
          <Link href="/dashboard" className="wordmark">Odysseus</Link>

          <nav className="app-nav" aria-label="App navigation">
            {nav.map(([key, href, label]) => (
              <Link
                key={key}
                href={href}
                aria-current={active === key ? "page" : undefined}
                className={active === key ? "app-nav-active" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>

          <div className="app-account">
            <Link href="/billing" className="app-balance-link">
              <span>{applicationCredits} app credits</span>
              <span>{interviewPasses} live passes</span>
            </Link>
            <details className="account-menu">
              <summary className="avatar" title={fullName || undefined}>
                {firstName(fullName).slice(0, 1).toUpperCase()}
              </summary>
              <div className="account-menu-panel">
                <div className="account-menu-name">{fullName || "Your account"}</div>
                <Link href="/billing">Billing</Link>
                <Link href="/integrations">Integrations</Link>
                <Link href="/settings">Settings</Link>
                <form action={logout}>
                  <button type="submit" className="account-menu-logout">Log out</button>
                </form>
              </div>
            </details>
          </div>
        </div>
      </header>
      {children}
    </main>
  );
}
