import Link from "next/link";
import EmployerNav from "@/components/employer-nav";
import { employerLogin } from "@/app/employers/actions";

export default async function EmployerLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="figma-site figma-dark-page">
      <div className="figma-page-wrap">
        <EmployerNav inverse />
        <section style={{ width: "min(520px,100%)", margin: "90px auto 130px" }}>
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
            <p className="odesseus-desktop-only" style={{ marginTop: 18 }}>New to Odesseus for Employers? <Link href="/employers/signup" className="link">Create an employer account</Link></p>
            <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>Looking for jobs? <Link href="/login" className="link">Candidate Sign In</Link></p>
          </div>
        </section>
      </div>
    </main>
  );
}
