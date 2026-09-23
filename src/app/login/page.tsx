import Link from "next/link";
import OdesseusWordmark from "@/components/odesseus-wordmark";
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="shell" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "50px 0" }}>
      <div style={{ width: "min(430px,100%)" }}>
        <OdesseusWordmark href="/" size="lg" />
        <div style={{ marginTop: 60 }}>
          <div className="badge">CANDIDATE SIGN IN ONLY</div>
          <h1 style={{ fontSize: 42, letterSpacing: "-0.045em", marginBottom: 10, marginTop: 18 }}>Welcome back.</h1>
          <p className="muted" style={{ marginBottom: 30 }}>Sign in to your candidate account and pick up where you left off.</p>

          <form className="card" style={{ padding: 24 }} action={login}>
            {error ? (
              <div style={{ marginBottom: 18, padding: 12, borderRadius: 12, background: "#fff1ef", fontSize: 14 }}>
                {error}
              </div>
            ) : null}

            <label style={{ display: "grid", gap: 8, fontSize: 14, fontWeight: 650 }}>
              Email
              <input className="input" name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
            </label>

            <label style={{ display: "grid", gap: 8, fontSize: 14, fontWeight: 650, marginTop: 18 }}>
              Password
              <input className="input" name="password" type="password" autoComplete="current-password" required placeholder="••••••••" />
            </label>

            <button className="btn btn-primary" type="submit" style={{ width: "100%", marginTop: 22 }}>
              Sign in
            </button>
          </form>

          <p className="muted" style={{ textAlign: "center", fontSize: 14, marginTop: 18 }}>
            New to Odesseus? <Link href="/signup" className="link">Create a candidate account</Link>
          </p>
          <p className="muted" style={{ textAlign: "center", fontSize: 13, marginTop: 10 }}>
            Hiring for a company? <Link href="/employers/login" className="link">Employer Sign In</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
