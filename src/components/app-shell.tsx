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
  active?: "home" | "applications" | "interviews" | "profile";
  children: React.ReactNode;
}) {
  const nav = [
    ["home", "/dashboard", "Home"],
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
            <div className="avatar" title={fullName || undefined}>
              {firstName(fullName).slice(0, 1).toUpperCase()}
            </div>
            <form action={logout}>
              <button type="submit" className="app-logout">Log out</button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </main>
  );
}
