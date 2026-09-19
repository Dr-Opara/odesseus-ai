import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getProviderToken } from "@/lib/integrations/oauth";
import {
  integrationProviders,
  type IntegrationProvider,
  type IntegrationService,
} from "@/lib/integrations/providers";
import IntegrationSyncButton from "@/components/integration-sync-button";
import ImapConnectForm from "@/components/imap-connect-form";

function providerLabel(provider: string) {
  return (
    integrationProviders[provider as IntegrationProvider]?.label ||
    provider
  );
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    connected?: string;
    error?: string;
    outbound?: string;
  }>;
}) {
  const { connected, error, outbound } = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) redirect("/login");

  const service = createServiceClient();

  if (connected) {
    const { data: account } = await service
      .from("integration_accounts")
      .select("*")
      .eq("id", connected)
      .eq("user_id", userId)
      .maybeSingle();

    if (account?.auth_method === "oauth") {
      try {
        await getProviderToken(
          userId,
          account.provider as IntegrationProvider,
          account.service_type as IntegrationService
        );

        await service
          .from("integration_accounts")
          .update({
            status: "connected",
            connected_at: new Date().toISOString(),
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", account.id);
      } catch (authError) {
        await service
          .from("integration_accounts")
          .update({
            status: "error",
            last_error:
              authError instanceof Error
                ? authError.message
                : "Authorization could not be verified.",
            updated_at: new Date().toISOString(),
          })
          .eq("id", account.id);
      }
    }
  }

  const [{ data: accounts }, { count: signals }] = await Promise.all([
    supabase
      .from("integration_accounts")
      .select("id,service_type,provider,account_email,status,last_sync_at,last_error")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("external_signals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);

  const emailAccounts =
    accounts?.filter((account) => account.service_type === "email") || [];
  const calendarAccounts =
    accounts?.filter((account) => account.service_type === "calendar") || [];

  return (
    <main className="shell" style={{ padding: "54px 0 100px" }}>
      <Link href="/profile" className="muted" style={{ fontSize: 14 }}>
        ← Profile
      </Link>

      <div style={{ width: "min(900px,100%)", margin: "52px auto 0" }}>
        <div className="badge">Integrations</div>
        <h1
          style={{
            fontSize: 46,
            letterSpacing: "-0.05em",
            margin: "16px 0 8px",
          }}
        >
          Connect where your career updates arrive.
        </h1>
        <p
          className="muted"
          style={{ fontSize: 18, lineHeight: 1.6, maxWidth: 720 }}
        >
          Email and calendar are independent. Connect any combination that
          matches how you actually work.
        </p>

        {error ? (
          <div className="apply-error" style={{ marginTop: 18 }}>
            {error}
          </div>
        ) : null}

        {outbound ? (
          <div className="billing-success" style={{ marginTop: 18 }}>
            Follow-up sending authorization completed for {outbound}.
          </div>
        ) : null}

        <div className="integration-summary-row">
          <div>
            <strong>{accounts?.filter((item) => item.status === "connected").length || 0}</strong>
            <span className="muted"> connected accounts</span>
          </div>
          <div>
            <strong>{signals ?? 0}</strong>
            <span className="muted"> detected signals</span>
          </div>
          <IntegrationSyncButton />
        </div>

        <section className="integration-section">
          <div>
            <div className="muted" style={{ fontSize: 13 }}>Email</div>
            <h2 style={{ fontSize: 28, margin: "7px 0 6px" }}>
              Recruiter and employer messages
            </h2>
            <p className="muted" style={{ margin: 0 }}>
              Odysseus reads only enough context to match updates to your tracked applications.
            </p>
          </div>

          {emailAccounts.length ? (
            <div className="integration-account-list">
              {emailAccounts.map((account) => (
                <div className="card integration-account-row" key={account.id}>
                  <div>
                    <strong>{providerLabel(account.provider)}</strong>
                    <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                      {account.account_email || "Connected account"}
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {account.last_sync_at
                      ? `Last sync ${new Date(account.last_sync_at).toLocaleString()}`
                      : account.status}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="integration-provider-grid">
            <div className="card integration-provider-card">
              <strong>Google</strong>
              <span className="muted">Gmail / Google Workspace</span>
              <a
                className="btn btn-secondary"
                href="/api/integrations/oauth/connect?provider=google&service=email"
              >
                Connect
              </a>
            </div>

            <div className="card integration-provider-card">
              <strong>Microsoft</strong>
              <span className="muted">Outlook / Hotmail / Microsoft 365</span>
              <a
                className="btn btn-secondary"
                href="/api/integrations/oauth/connect?provider=microsoft&service=email"
              >
                Connect
              </a>
            </div>

            <div className="card integration-provider-card">
              <strong>Yahoo</strong>
              <span className="muted">OAuth + Yahoo Mail</span>
              <form method="get" action="/api/integrations/oauth/connect" className="integration-mini-form">
                <input type="hidden" name="provider" value="yahoo" />
                <input type="hidden" name="service" value="email" />
                <input className="input" type="email" name="email" placeholder="you@yahoo.com" required />
                <button className="btn btn-secondary" type="submit">Connect</button>
              </form>
            </div>

            <div className="card integration-provider-card">
              <strong>iCloud Mail</strong>
              <span className="muted">Private IMAP with app-specific password</span>
              <ImapConnectForm provider="icloud" />
            </div>

            <div className="card integration-provider-card integration-provider-wide">
              <strong>Other email</strong>
              <span className="muted">
                Custom domain or IMAP-compatible mailbox
              </span>
              <ImapConnectForm provider="imap" />
            </div>
          </div>
        </section>

        <section className="integration-section">
          <div>
            <div className="muted" style={{ fontSize: 13 }}>Optional follow-up sending</div>
            <h2 style={{ fontSize: 28, margin: "7px 0 6px" }}>
              Send approved follow-ups from Odysseus
            </h2>
            <p className="muted" style={{ margin: 0 }}>
              This permission is separate from read-only detection. Skip it if you prefer Odysseus to open approved drafts in your normal email app.
            </p>
          </div>

          <div className="integration-provider-grid">
            <div className="card integration-provider-card">
              <strong>Google send</strong>
              <span className="muted">Optional Gmail send permission for approved follow-ups only.</span>
              <a
                className="btn btn-secondary"
                href="/api/integrations/outbound/connect?provider=google"
              >
                Enable sending
              </a>
            </div>

            <div className="card integration-provider-card">
              <strong>Microsoft send</strong>
              <span className="muted">Optional Outlook / Microsoft 365 send permission for approved follow-ups only.</span>
              <a
                className="btn btn-secondary"
                href="/api/integrations/outbound/connect?provider=microsoft"
              >
                Enable sending
              </a>
            </div>
          </div>
        </section>

        <section className="integration-section">
          <div>
            <div className="muted" style={{ fontSize: 13 }}>Calendar</div>
            <h2 style={{ fontSize: 28, margin: "7px 0 6px" }}>
              Scheduled interview detection
            </h2>
            <p className="muted" style={{ margin: 0 }}>
              Calendar connections are optional and can use a different provider than email.
            </p>
          </div>

          {calendarAccounts.length ? (
            <div className="integration-account-list">
              {calendarAccounts.map((account) => (
                <div className="card integration-account-row" key={account.id}>
                  <div>
                    <strong>{providerLabel(account.provider)}</strong>
                    <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                      {account.account_email || "Calendar"}
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {account.last_sync_at
                      ? `Last sync ${new Date(account.last_sync_at).toLocaleString()}`
                      : account.status}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="integration-provider-grid">
            <div className="card integration-provider-card">
              <strong>Google Calendar</strong>
              <span className="muted">Google personal or Workspace</span>
              <a
                className="btn btn-secondary"
                href="/api/integrations/oauth/connect?provider=google&service=calendar"
              >
                Connect
              </a>
            </div>

            <div className="card integration-provider-card">
              <strong>Microsoft Calendar</strong>
              <span className="muted">Outlook / Microsoft 365</span>
              <a
                className="btn btn-secondary"
                href="/api/integrations/oauth/connect?provider=microsoft&service=calendar"
              >
                Connect
              </a>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
