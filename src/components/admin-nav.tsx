"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import OdesseusWordmark from "@/components/odesseus-wordmark";

const adminNavLinks = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/wallets", label: "Wallets" },
  { href: "/admin/applications", label: "Applications" },
  { href: "/admin/employers", label: "Employers" },
  { href: "/admin/jobs", label: "Jobs" },
  { href: "/admin/careers", label: "Careers" },
  { href: "/admin/partners", label: "Partners" },
  { href: "/admin/referrals", label: "Referrals" },
  { href: "/admin/billing", label: "Billing" },
  { href: "/admin/live", label: "Live" },
  { href: "/admin/system", label: "System" },
];

export default function AdminNav({ role }: { role?: string | null }) {
  const pathname = usePathname();

  return (
    <header className="admin-nav">
      <div className="shell admin-nav-inner">
        <OdesseusWordmark href="/admin" size="sm" />
        <nav className="admin-nav-links" aria-label="Admin">
          {adminNavLinks.map((link) => {
            const active = link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
            return (
              <Link key={link.href} href={link.href} className={active ? "is-active" : undefined}>
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="admin-nav-actions">
          <span className="badge">{role || "Admin"}</span>
          <Link className="btn btn-secondary" href="/dashboard">Exit</Link>
        </div>
      </div>
    </header>
  );
}
