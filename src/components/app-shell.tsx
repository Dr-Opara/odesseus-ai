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
  // MobileRouteExperience already renders a dedicated Figma mobile screen (with
  // its own bottom nav) for any route resolveMobileScreen() covers. Rendering
  // this nav unconditionally on those routes would double-mount a second bottom
  // nav alongside it. Only fall back to this nav on routes Figma Mobile v1
  // doesn't have a screen for yet (e.g. /billing, /interviews/[id]/live).
  const hasDedicatedMobileScreen = resolveMobileScreen(pathname) !== null;

  const nav = [
    ["home", "/dashboard", "Home"],
    ["jobs", "/jobs", "Match"],
    ["applications", "/applications", "Apps"],
    ["interviews", "/interviews", "Prep"],
    ["profile", "/profile", "Profile"],
  ] as const;

  return (
    <main className="app-surface">
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
              <span>{walletBalanceCents !== undefined ? `Wallet ${(walletBalanceCents / 100).toFixed(2)}` : applicationCredits > 0 ? `${applicationCredits} legacy app credit${applicationCredits === 1 ? "" : "s"}` : "Wallet"}</span>
              <span>{interviewPasses} live pass{interviewPasses === 1 ? "" : "es"}</span>
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
      {hasDedicatedMobileScreen ? null : (
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
