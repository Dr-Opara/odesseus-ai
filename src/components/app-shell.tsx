"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import OdesseusWordmark from "@/components/odesseus-wordmark";
import { logout } from "@/app/login/actions";
import { resolveMobileScreen } from "@/lib/mobile/screen-map";

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
  const pathname = usePathname();
  const screen = resolveMobileScreen(pathname);
  // A "wired" screen renders its own real mobile presentation (Phase 5), so
  // the AppShell chrome stays desktop-only. Mapped screens that are not wired
  // yet fall back to the desktop layout plus a mobile bottom nav so navigation
  // still works while later batches land.
  const hasWiredMobileScreen = screen !== null && screen.wired;

  const nav = [
    ["home", "/dashboard", "Home"],
    ["jobs", "/jobs", "Match"],
    ["applications", "/applications", "Apps"],
    ["interviews", "/interviews", "Prep"],
    ["profile", "/profile", "Profile"],
  ] as const;

  return (
    <main className={`app-surface${hasWiredMobileScreen ? " mobile-dedicated" : ""}`}>
      <header className="app-header">
        <div className="shell app-header-inner">
          <OdesseusWordmark href="/dashboard" size="md" className="wordmark" />

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
      {hasWiredMobileScreen ? null : (
        <nav className="mobile-app-bottom-nav" aria-label="Mobile app navigation">
          {nav.map(([key, href, label]) => (
            <Link key={key} href={href} aria-current={active === key ? "page" : undefined} className={active === key ? "is-active" : undefined}>
              <span className="mobile-nav-icon" aria-hidden="true">{key === "home" ? "⌂" : key === "jobs" ? "◎" : key === "applications" ? "▤" : key === "interviews" ? "✦" : "○"}</span>
              <span>{label}</span>
            </Link>
          ))}
        </nav>
      )}
    </main>
  );
}
