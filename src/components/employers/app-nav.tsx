import Link from "next/link";
import OdesseusWordmark from "@/components/odesseus-wordmark";

/**
 * Minimal authenticated employer app header (Figma screen 85 and beyond) —
 * distinct from the public marketing `EmployerNav` (which shows "Sign In" /
 * a "Post a Job" marketing CTA and is desktop-only). This is the header for
 * screens an employer only sees once signed in. Link set grows as later
 * checkpoints (4-6) add Dashboard/Jobs/Candidates/etc.
 */
export default function EmployerAppNav() {
  return (
    <header className="figma-nav emp-app-nav">
      <div className="figma-nav-inner">
        <OdesseusWordmark href="/employers/dashboard" size="sm" />
        <nav className="figma-nav-links" aria-label="Employer">
          <Link href="/employers/dashboard">Dashboard</Link>
          <Link href="/employers/company">Company Profile</Link>
        </nav>
        <div className="figma-nav-actions">
          <Link className="figma-btn figma-btn-orange" href="/employers/post-job">
            Post a Job
          </Link>
        </div>
      </div>
    </header>
  );
}
