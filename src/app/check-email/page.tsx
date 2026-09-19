import Link from "next/link";

export default function CheckEmailPage() {
  return (
    <main className="shell" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "50px 0" }}>
      <div className="card" style={{ width: "min(520px,100%)", padding: 34, textAlign: "center" }}>
        <div style={{ fontSize: 36 }}>✉</div>
        <h1 style={{ fontSize: 34, letterSpacing: "-0.04em", marginBottom: 10 }}>Check your email.</h1>
        <p className="muted" style={{ lineHeight: 1.6 }}>
          Confirm your email address, then come back to Odysseus and sign in.
        </p>
        <Link className="btn btn-primary" href="/login" style={{ marginTop: 16 }}>Back to sign in</Link>
      </div>
    </main>
  );
}
