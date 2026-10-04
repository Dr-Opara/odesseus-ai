import Link from "next/link";
import { signup } from "@/app/login/actions";
import GoogleSignupButton from "@/components/google-signup-button";
import MobileSignupWizard from "@/components/mobile/mobile-signup-wizard";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <>
    <main className="candidate-signup-shell odesseus-desktop-only">
      <section className="candidate-signup-wrap">
        <header className="candidate-signup-header">
          <h1>Create Account</h1>
          <p>Start your accelerated job search today.</p>
        </header>

        <Link href="/" className="candidate-signup-back">← Back</Link>

        <div className="candidate-signup-card">
          {error ? <div className="candidate-signup-error">{error}</div> : null}

          <GoogleSignupButton />

          <div className="candidate-signup-divider">
            <span />
            <b>OR</b>
            <span />
          </div>

          <form action={signup}>
            <div className="candidate-name-grid">
              <label>
                First Name
                <input className="input" name="first_name" autoComplete="given-name" required placeholder="John" />
              </label>
              <label>
                Last Name
                <input className="input" name="last_name" autoComplete="family-name" required placeholder="Doe" />
              </label>
            </div>

            <label className="candidate-field">
              Email Address
              <input className="input" name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
            </label>

            <label className="candidate-field">
              Password
              <input className="input" name="password" type="password" autoComplete="new-password" minLength={8} required placeholder="••••••••" />
              <small>Must be at least 8 characters long</small>
            </label>

            <button className="candidate-continue-button" type="submit">Continue</button>
          </form>

          <p className="candidate-legal-copy">
            By continuing, you agree to our <Link href="/terms">Terms of Service</Link> and <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </div>

        <p className="candidate-signin-copy">
          Already have an account? <Link href="/login">Sign In</Link>
        </p>
      </section>
    </main>
    <MobileSignupWizard error={error} />
    </>
  );
}
