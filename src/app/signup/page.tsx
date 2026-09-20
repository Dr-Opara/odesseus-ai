import Image from "next/image";
import Link from "next/link";
import { signup } from "@/app/login/actions";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="shell" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "50px 0" }}>
      <div style={{ width: "min(430px,100%)" }}>
        <Link href="/" style={{ display: "inline-flex" }}>
          <Image src="/odesseus-logo.png" alt="Odesseus.ai" width={172} height={28} priority style={{ height: 28, width: "auto" }} />
        </Link>
        <div style={{ marginTop: 50 }}>
          <div className="badge">Start free</div>
          <h1 style={{ fontSize: 42, letterSpacing: "-0.045em", margin: "16px 0 10px" }}>Meet Odesseus.</h1>
          <p className="muted" style={{ marginBottom: 30 }}>Create your account. Your career profile comes next.</p>

          <form className="card" style={{ padding: 24 }} action={signup}>
            {error ? (
              <div style={{ marginBottom: 18, padding: 12, borderRadius: 12, background: "#fff1ef", fontSize: 14 }}>
                {error}
              </div>
            ) : null}

            <label style={{ display: "grid", gap: 8, fontSize: 14, fontWeight: 650 }}>
              Name
              <input className="input" name="full_name" autoComplete="name" required placeholder="Your name" />
            </label>

            <label style={{ display: "grid", gap: 8, fontSize: 14, fontWeight: 650, marginTop: 18 }}>
              Email
              <input className="input" name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
            </label>

            <label style={{ display: "grid", gap: 8, fontSize: 14, fontWeight: 650, marginTop: 18 }}>
              Password
              <input className="input" name="password" type="password" autoComplete="new-password" minLength={8} required placeholder="At least 8 characters" />
            </label>

            <button className="btn btn-primary" type="submit" style={{ width: "100%", marginTop: 22 }}>
              Create account
            </button>
          </form>

          <p className="muted" style={{ textAlign: "center", fontSize: 14, marginTop: 18 }}>
            Already have an account? <Link href="/login" className="link">Sign in</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
