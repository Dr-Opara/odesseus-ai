"use client";

import { useState } from "react";

type Provider =
  | "supabase"
  | "browserbase"
  | "openai"
  | "stripe"
  | "stripe_webhook"
  | "job_discovery"
  | "cron"
  | "google"
  | "microsoft"
  | "yahoo"
  | "google_send"
  | "microsoft_send"
  | "resend";

type ConfigItem = {
  key: string;
  label: string;
  configured: boolean;
  group: string;
};

type Result = {
  ok: boolean;
  detail: string;
  latencyMs?: number;
};

const testable: Array<{ provider: Provider; label: string }> = [
  { provider: "supabase", label: "Supabase" },
  { provider: "browserbase", label: "Browserbase" },
  { provider: "openai", label: "OpenAI" },
  { provider: "stripe", label: "Stripe API" },
  { provider: "stripe_webhook", label: "Stripe Webhook" },
  { provider: "job_discovery", label: "Job Discovery" },
  { provider: "cron", label: "Scheduled Jobs" },
  { provider: "google", label: "Google Connector" },
  { provider: "microsoft", label: "Microsoft Connector" },
  { provider: "yahoo", label: "Yahoo Connector" },
  { provider: "google_send", label: "Google Send Connector" },
  { provider: "microsoft_send", label: "Microsoft Send Connector" },
  { provider: "resend", label: "Resend" },
];

export default function AdminSystemReadiness({
  config,
}: {
  config: ConfigItem[];
}) {
  const [busy, setBusy] = useState<Provider | null>(null);
  const [results, setResults] = useState<Partial<Record<Provider, Result>>>({});

  async function run(provider: Provider) {
    setBusy(provider);
    try {
      const response = await fetch("/api/admin/system/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await response.json();
      setResults((current) => ({
        ...current,
        [provider]: {
          ok: Boolean(data.ok),
          detail: data.detail || data.error || "Check completed.",
          latencyMs: data.latencyMs,
        },
      }));
    } catch {
      setResults((current) => ({
        ...current,
        [provider]: { ok: false, detail: "Could not run the readiness check." },
      }));
    } finally {
      setBusy(null);
    }
  }

  const groups = [...new Set(config.map((item) => item.group))];

  return (
    <div className="system-readiness">
      <section className="system-readiness-tests">
        {testable.map((item) => {
          const result = results[item.provider];
          return (
            <article className="card system-readiness-test" key={item.provider}>
              <div>
                <div className="system-readiness-test-name">{item.label}</div>
                <div className="muted system-readiness-result">
                  {result ? result.detail : "Not tested in this session."}
                </div>
                {result?.latencyMs != null ? (
                  <small className="muted">{result.latencyMs} ms</small>
                ) : null}
              </div>
              <div className="system-readiness-test-actions">
                {result ? (
                  <span className={result.ok ? "readiness-status good" : "readiness-status bad"}>
                    {result.ok ? "Passed" : "Failed"}
                  </span>
                ) : null}
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => run(item.provider)}
                >
                  {busy === item.provider ? "Testing…" : "Test"}
                </button>
              </div>
            </article>
          );
        })}
      </section>

      <section className="system-config-groups">
        {groups.map((group) => (
          <div className="card system-config-card" key={group}>
            <h2>{group}</h2>
            <div className="system-config-list">
              {config.filter((item) => item.group === group).map((item) => (
                <div className="system-config-row" key={item.key}>
                  <span>{item.label}</span>
                  <span className={item.configured ? "readiness-status good" : "readiness-status bad"}>
                    {item.configured ? "Configured" : "Missing"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
