import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  GOOGLE_CONNECTOR,
  getGoogleAccessToken,
} from "@/lib/integrations/google-auth";
import GoogleSyncButton from "@/components/google-sync-button";
import AppShell from "@/components/app-shell";

export default async function GoogleIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{
    connected?: string;
    disconnected?: string;
    error?: string;
  }>;
}) {
  const { connected, disconnected, error } = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) redirect("/login");

  const service = createServiceClient();

  if (connected === "1") {
    try {
      await getGoogleAccessToken(userId);
      const now = new Date().toISOString();

      const { data: prior } = await service
        .from("integration_connections")
        .select("connected_at")
        .eq("user_id", userId)
        .eq("provider", "google")
        .maybeSingle();

      await service.from("integration_connections").upsert({
        user_id: userId,
        provider: "google",
        status: "connected",
        connector_id: GOOGLE_CONNECTOR,
        connected_at: prior?.connected_at || now,
        last_error: null,
        updated_at: now,
      });
    } catch (authError) {
      const message =
        authError instanceof Error
          ? authError.message
          : "Google authorization could not be verified.";

      await service.from("integration_connections").upsert({
        user_id: userId,
        provider: "google",
        status: "error",
        connector_id: GOOGLE_CONNECTOR,
        last_error: message.slice(0, 1000),
        updated_at: new Date().toISOString(),
      });
    }
  }

  const [
    { data: connection },
    { count: signalCount },
    { data: profile },
    { data: credits },
  ] = await Promise.all([
    supabase
      .from("integration_connections")
      .select("status,last_sync_at,last_error,connected_at")
      .eq("user_id", userId)
      .eq("provider", "google")
      .maybeSingle(),
    supabase
      .from("external_signals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("credit_balances")
      .select("wallet_balance_cents,interview_passes")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const isConnected = connection?.status === "connected";

  return (
    <AppShell
      fullName={profile?.full_name}
      walletBalanceCents={credits?.wallet_balance_cents ?? 0}
      interviewPasses={credits?.interview_passes ?? 0}
      active="profile"
    >
      <section className="shell" style={{ padding: "54px 0 100px" }}>
        <Link href="/profile" className="muted" style={{ fontSize: 14 }}>
          ← Profile
        </Link>

        <div style={{ width: "min(760px,100%)", margin: "20px auto 0" }}>
          <div className="badge">Google integration</div>
          <h1
            style={{
              fontSize: 46,
              letterSpacing: "-0.05em",
              margin: "16px 0 8px",
            }}
          >
            Keep your job search in sync.
          </h1>
          <p
            className="muted"
            style={{ fontSize: 18, lineHeight: 1.6, margin: 0 }}
          >
            Connect Gmail and Google Calendar so Odesseus can detect employer
            responses, assessments, interview invitations, offers, rejections,
            and scheduled interviews.
          </p>

          {error ? (
            <div className="apply-error" style={{ marginTop: 20 }}>
              {error}
            </div>
          ) : null}

          {disconnected ? (
            <div className="billing-success" style={{ marginTop: 20 }}>
              Google has been disconnected.
            </div>
          ) : null}

          <div className="card google-connection-card">
            <div>
              <div className="muted" style={{ fontSize: 13 }}>
                Connection
              </div>
              <h2 style={{ fontSize: 24, margin: "7px 0 5px" }}>
                {isConnected
                  ? "Google is connected."
                  : "Connect your Google account."}
              </h2>
              <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
                Odesseus requests read-only Gmail and Calendar access. It does
                not send, delete, edit, or mark email as read, and it does not
                create or modify calendar events.
              </p>
            </div>

            {isConnected ? (
              <div style={{ display: "grid", gap: 10 }}>
                <GoogleSyncButton />
                <form
                  action="/api/integrations/google/disconnect"
                  method="post"
                >
                  <button className="app-logout" type="submit">
                    Disconnect Google
                  </button>
                </form>
              </div>
            ) : (
              <a
                className="btn btn-primary"
                href="/api/integrations/google/connect"
              >
                Connect Google
              </a>
            )}
          </div>

          <div className="google-sync-grid">
            <div className="card google-sync-card">
              <span className="muted">Last sync</span>
              <strong>
                {connection?.last_sync_at
                  ? new Date(connection.last_sync_at).toLocaleString()
                  : "Not synced yet"}
              </strong>
            </div>
            <div className="card google-sync-card">
              <span className="muted">Detected signals</span>
              <strong>{signalCount ?? 0}</strong>
            </div>
          </div>

          {connection?.last_error ? (
            <div className="review-note">
              <strong>Last sync issue:</strong> {connection.last_error}
            </div>
          ) : null}

          <div className="card google-privacy-card">
            <div className="muted" style={{ fontSize: 13 }}>
              What Odesseus looks for
            </div>
            <div className="google-detection-list">
              <span>Recruiter and employer responses</span>
              <span>Assessments and take-home requests</span>
              <span>Interview invitations and scheduling updates</span>
              <span>Offers and rejection updates</span>
            </div>
            <p
              className="muted"
              style={{ margin: "18px 0 0", lineHeight: 1.55 }}
            >
              Odesseus only turns a message or event into a pipeline update
              when it can confidently connect it to one of your tracked
              applications. Ambiguous items are ignored.
            </p>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
