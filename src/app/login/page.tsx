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
      <div className="candidate-auth-wrap">
        <OdesseusWordmark href="/" size="lg" />
        <div style={{ marginTop: 60 }}>
          <div className="badge">CANDIDATE SIGN IN ONLY</div>
          <h1 style={{ fontSize: 42, letterSpacing: "-0.045em", marginBottom: 10, marginTop: 18 }}>Welcome back.</h1>
          <p className="muted" style={{ marginBottom: 30 }}>Sign in to your candidate account and pick up where you left off.</p>

          <form className="candidate-auth-card" action={login}>
            {error ? (
              <div className="candidate-auth-error">
                {error}
              </div>
            ) : null}

            <label className="candidate-field">
              Email
              <input className="input" name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
            </label>

            <label className="candidate-field">
              Password
              <input className="input" name="password" type="password" autoComplete="current-password" required placeholder="••••••••" />
            </label>

            <button className="candidate-auth-submit" type="submit">
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
