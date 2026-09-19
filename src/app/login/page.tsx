import Link from "next/link";
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
        <Link href="/" style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.04em" }}>Odysseus</Link>
        <div style={{ marginTop: 60 }}>
          <h1 style={{ fontSize: 42, letterSpacing: "-0.045em", marginBottom: 10 }}>Welcome back.</h1>
          <p className="muted" style={{ marginBottom: 30 }}>Pick up where you left off.</p>

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
            New to Odysseus? <Link href="/signup" style={{ color: "var(--text)", fontWeight: 700 }}>Create an account</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
