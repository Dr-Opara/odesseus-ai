import Link from "next/link";
import OdesseusWordmark from "@/components/odesseus-wordmark";

/**
 * Role-selection sign-in chooser (Figma screen 03 — Sign In / Choose Role).
 * The generic public "Sign in" entry point routes here first; each card then
 * hands off to the existing candidate (`/login`) or employer
 * (`/employers/login`) sign-in flow. Neither of those flows changes.
 */
export default function SignInChooserPage() {
  return (
    <main className="shell figma-signin-shell">
      <Link href="/" aria-label="Back" className="figma-signin-back">
        ←
      </Link>
      <OdesseusWordmark href="/" size="lg" />
      <div className="figma-signin-intro">
        <h1>Welcome Back</h1>
        <p className="muted">Choose how you want to sign in.</p>
      </div>

      <div className="figma-signin-grid">
        <Link href="/login" className="figma-signin-card">
          <span className="figma-signin-icon" aria-hidden="true">
            ♙
          </span>
          <span className="figma-signin-copy">
            <strong>Job Seeker</strong>
            <small>Sign in to your job seeker account</small>
          </span>
          <span className="figma-signin-action figma-signin-action-orange">Continue</span>
        </Link>

        <Link href="/employers/login" className="figma-signin-card">
          <span className="figma-signin-icon" aria-hidden="true">
            ▣
          </span>
          <span className="figma-signin-copy">
            <strong>Employer</strong>
            <small>Sign in to your employer account</small>
          </span>
          <span className="figma-signin-action figma-signin-action-dark">Continue</span>
        </Link>
      </div>

      <p className="muted figma-signin-footer">
        Don&apos;t have an account? <Link href="/signup" className="link">Sign up</Link>
      </p>
    </main>
  );
}
