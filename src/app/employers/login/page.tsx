import Link from "next/link";
import EmployerNav from "@/components/employer-nav";
import { employerLogin } from "@/app/employers/actions";

/**
 * Employer sign-in (Phase 5).
 *
 * This is the phone entry point for businesses: the mobile splash's Business
 * Login action lands here, and a successful sign-in goes to the employer
 * portal. Sign-up is desktop-only (see `signup/page.tsx`), so the "create an
 * employer account" link is `odesseus-desktop-only` and the phone rendering
 * offers sign-in plus a way back to the splash.
 */
export default async function EmployerLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <main className="figma-site figma-dark-page">
      <div className="figma-page-wrap">
        <div className="odesseus-desktop-only">
          <EmployerNav inverse />
        </div>

        <section style={{ width: "min(520px,100%)", margin: "90px auto 130px" }} className="odesseus-desktop-only">
          <div className="figma-info-card white" style={{ padding: 34 }}>
            <span className="figma-eyebrow">EMPLOYER SIGN IN ONLY</span>
            <h1 style={{ marginTop: 12 }}>Welcome back.</h1>
            <p>Sign in with the company account you use for Odesseus.</p>
            {error ? <div style={{ margin: "18px 0", padding: 12, borderRadius: 12, background: "#fff1ef", color: "#8d1d12" }}>{error}</div> : null}
            <form action={employerLogin}>
              <label style={{ display: "grid", gap: 8, marginTop: 22, fontWeight: 650 }}>
                Company email
                <input className="input" name="email" type="email" required placeholder="you@company.com" />
              </label>
              <label style={{ display: "grid", gap: 8, marginTop: 18, fontWeight: 650 }}>
                Password
                <input className="input" name="password" type="password" required placeholder="Your password" />
              </label>
              <button className="figma-btn figma-btn-orange" type="submit" style={{ width: "100%", marginTop: 24 }}>Sign In</button>
            </form>
            <p style={{ marginTop: 18 }}>New to Odesseus for Employers? <Link href="/employers/signup" className="link">Create an employer account</Link></p>
            <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>Looking for jobs? <Link href="/login" className="link">Candidate Sign In</Link></p>
          </div>
        </section>

        <section className="odesseus-mobile-only" style={{ padding: "24px 20px 44px" }}>
          <span className="m-eyebrow">FOR EMPLOYERS</span>
          <h1 style={{ fontSize: 28, margin: "0 0 10px", letterSpacing: "-.03em" }}>Business Login</h1>
          <p className="m-lead">Sign in with the company account you use for Odesseus.</p>

          {error ? (
            <p className="m-note" style={{ margin: "0 4px", background: "#fff1ef", color: "#8d1d12" }}>
              {error}
            </p>
          ) : null}

          <form action={employerLogin}>
            <label style={{ display: "grid", gap: 8, marginTop: 18, fontWeight: 650 }}>
              Company email
              <input className="input" name="email" type="email" required placeholder="you@company.com" />
            </label>
            <label style={{ display: "grid", gap: 8, marginTop: 16, fontWeight: 650 }}>
              Password
              <input className="input" name="password" type="password" required placeholder="Your password" />
            </label>
            <button className="m-action" type="submit">Sign In</button>
          </form>

          <p className="m-note" style={{ marginTop: 14 }}>
            New to Odesseus for Employers? Employer accounts are set up on a desktop browser, and{" "}
            <Link href="/employers/pricing" className="link">see employer pricing</Link>.
          </p>
          <p className="m-note" style={{ marginTop: 10 }}>
            Looking for jobs? <Link href="/login" className="link">Candidate Sign In</Link>
          </p>
          <p style={{ marginTop: 16 }}>
            <Link className="link" href="/">Back to Odesseus</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
