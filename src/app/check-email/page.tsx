import Link from "next/link";
import { resendVerification } from "@/app/login/actions";

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{
    email?: string;
    resent?: string;
    reason?: string;
    error?: string;
  }>;
}) {
  const { email = "", resent, reason, error } = await searchParams;
  const displayEmail = email.trim();

  return (
    <main
      className="shell"
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "50px 0",
      }}
    >
      <div
        className="card"
        style={{
          width: "min(560px,100%)",
          padding: 34,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 36 }}>✉</div>

        <h1
          style={{
            fontSize: 34,
            letterSpacing: "-0.04em",
            marginBottom: 10,
          }}
        >
          Check your email.
        </h1>

        <p className="muted" style={{ lineHeight: 1.6, marginBottom: 10 }}>
          {reason === "unconfirmed"
            ? "Your email address still needs to be verified before you can sign in."
            : "If this email address needs verification, Odesseus will send a confirmation link."}
        </p>

        {displayEmail ? (
          <p style={{ fontWeight: 700, margin: "8px 0 18px" }}>
            {displayEmail}
          </p>
        ) : null}

        <p className="muted" style={{ lineHeight: 1.6, marginBottom: 20 }}>
          If this address already belongs to a verified Odesseus account, you will not receive
          another signup email. Sign in with that account instead.
        </p>

        {resent ? (
          <div
            style={{
              marginBottom: 18,
              padding: 12,
              borderRadius: 12,
              background: "#eef8f0",
              fontSize: 14,
            }}
          >
            If verification is still required for this email, a new confirmation link has been sent.
          </div>
        ) : null}

        {error ? (
          <div
            style={{
              marginBottom: 18,
              padding: 12,
              borderRadius: 12,
              background: "#fff1ef",
              fontSize: 14,
            }}
          >
            {error}
          </div>
        ) : null}

        <form action={resendVerification} style={{ display: "grid", gap: 10 }}>
          <input
            className="input"
            name="email"
            type="email"
            defaultValue={displayEmail}
            autoComplete="email"
            required
            placeholder="you@example.com"
            aria-label="Email address"
          />
          <button className="btn btn-primary" type="submit" style={{ width: "100%" }}>
            Resend verification email
          </button>
        </form>

        <div
          style={{
            display: "flex",
            gap: 14,
            justifyContent: "center",
            flexWrap: "wrap",
            marginTop: 18,
          }}
        >
          <Link className="link" href="/login">
            Sign in instead
          </Link>
          <Link className="link" href="/signup">
            Use a different email
          </Link>
        </div>
      </div>
    </main>
  );
}
