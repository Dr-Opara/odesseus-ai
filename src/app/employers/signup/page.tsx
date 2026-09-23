import Link from "next/link";
import EmployerNav from "@/components/employer-nav";
import { employerSignup } from "@/app/employers/actions";

export default async function EmployerSignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="figma-site figma-dark-page">
      <div className="figma-page-wrap">
        <EmployerNav inverse />
        <section className="figma-two-grid" style={{ padding: "80px 0 110px", alignItems: "start" }}>
          <div className="figma-page-hero inverse" style={{ minHeight: 0, padding: 0, background: "transparent" }}>
            <span className="figma-eyebrow">FOR EMPLOYERS</span>
            <h1>Hire globally, with confidence.</h1>
            <p>AI-matched candidates. Verified employers. Simple, transparent pricing built for teams hiring across every market.</p>
            <p style={{ marginTop: 24 }}>✓ Verified Employer program &nbsp;&nbsp; ✓ AI candidate matching &nbsp;&nbsp; ✓ 150+ countries</p>
          </div>

          <div className="figma-info-card white" style={{ padding: 34 }}>
            <h2>Create your employer account</h2>
            <p>Set up your company and start posting roles.</p>
            {error ? <div style={{ margin: "18px 0", padding: 12, borderRadius: 12, background: "#fff1ef", color: "#8d1d12" }}>{error}</div> : null}
            <form action={employerSignup}>
              <label style={{ display: "grid", gap: 8, marginTop: 20, fontWeight: 650 }}>
                Company name
                <input className="input" name="company_name" required placeholder="Acme Corp" />
              </label>
              <label style={{ display: "grid", gap: 8, marginTop: 18, fontWeight: 650 }}>
                Company email
                <input className="input" name="email" type="email" required placeholder="you@company.com" />
                <span className="muted" style={{ fontSize: 12 }}>Personal email addresses such as Gmail, Yahoo, Outlook and iCloud are not accepted.</span>
              </label>
              <label style={{ display: "grid", gap: 8, marginTop: 18, fontWeight: 650 }}>
                Password
                <input className="input" name="password" type="password" minLength={8} required placeholder="Create a password" />
              </label>
              <button className="figma-btn figma-btn-orange" type="submit" style={{ width: "100%", marginTop: 24 }}>Create Account</button>
            </form>
            <p className="muted" style={{ marginTop: 18, fontSize: 13 }}>By creating an account, you agree to our <Link href="/terms" className="link">Terms of Service</Link> and <Link href="/privacy" className="link">Privacy Policy</Link>.</p>
            <p style={{ marginTop: 18 }}>Already have an account? <Link href="/employers/login" className="link">Sign in</Link></p>
          </div>
        </section>
      </div>
    </main>
  );
}
