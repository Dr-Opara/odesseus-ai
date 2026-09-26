import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIGRATION = "supabase/migrations/20261004000000_webhook_observability.sql";
// The repository stores LF, but Windows checkouts (core.autocrlf) may
// materialize CRLF; make regexes line-ending agnostic.
const sql = readFileSync(path.join(repoRoot, MIGRATION), "utf8").replace(/\r\n/g, "\n");

describe("Stripe webhook observability migration (M10 backend slice)", () => {
  it("is additive: no drops, deletions, or RLS weakening", () => {
    expect(sql).not.toMatch(/^DROP TABLE/i);
    expect(sql).not.toMatch(/^DROP COLUMN/i);
    expect(sql).not.toMatch(/^DELETE FROM/i);
    expect(sql).not.toMatch(/^DROP DATABASE/i);
    expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/GRANT .* TO (anon|authenticated)/i);
  });

  it("creates the webhook_events delivery log with the decided shape", () => {
    expect(sql).toMatch(/CREATE TABLE public\.webhook_events/);
    expect(sql).toMatch(/stripe_event_id\s+text/i);
    expect(sql).toMatch(/event_type\s+text/i);
    expect(sql).toMatch(/outcome\s+text\s+NOT NULL/i);
    expect(sql).toMatch(/http_status\s+smallint\s+NOT NULL/i);
    expect(sql).toMatch(/outcome IN \('received', 'rejected', 'fulfilled', 'errored', 'duplicate', 'ignored'\)/);
    expect(sql).toMatch(/http_status BETWEEN 200 AND 599/);
    expect(sql).toMatch(/user_id\s+uuid/i);
    expect(sql).toMatch(/org_id\s+uuid/i);
    expect(sql).toMatch(/details\s+jsonb\s+NOT NULL\s+DEFAULT '{}'::jsonb/i);
  });

  it("enables RLS and denies browser roles with the M9 server-only posture", () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(
      /CREATE POLICY "webhook_events_deny_browser_access" ON public\.webhook_events[\s\S]*?FOR ALL[\s\S]*?TO anon, authenticated[\s\S]*?USING \(false\)[\s\S]*?WITH CHECK \(false\)/
    );
    expect(sql).toContain("REVOKE ALL ON TABLE public.webhook_events FROM anon, authenticated;");
    expect(sql).toContain(
      "GRANT ALL PRIVILEGES ON TABLE public.webhook_events TO postgres, service_role;"
    );
  });

  it("scopes the log index and keeps user_id a SET NULL FK", () => {
    expect(sql).toMatch(/CREATE INDEX webhook_events_stripe_event_id_idx/);
    expect(sql).toMatch(/CREATE INDEX webhook_events_created_at_idx/);
    expect(sql).toMatch(/CREATE INDEX webhook_events_outcome_idx/);
    expect(sql).toMatch(
      /FOREIGN KEY \(user_id\) REFERENCES auth\.users\(id\) ON DELETE SET NULL/
    );
  });

  it("adds a fail-closed service-role-only logging RPC", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.odesseus_log_webhook_event/);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path TO 'public', 'odesseus_private', 'pg_temp'/);
    expect(sql).toMatch(/raise exception 'unknown webhook outcome: %'/i);
    expect(sql).toMatch(/raise exception 'webhook http_status out of range: %'/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.odesseus_log_webhook_event[\s\S]*?FROM PUBLIC/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.odesseus_log_webhook_event[\s\S]*?FROM anon/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.odesseus_log_webhook_event[\s\S]*?FROM authenticated/);
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.odesseus_log_webhook_event(text, text, text, integer, uuid, uuid, text, text, text, jsonb) TO postgres, service_role;"
    );
  });

  it("never touches candidate, employer, wallet, or storage tables", () => {
    for (const table of [
      "billing_events",
      "employer_subscriptions",
      "employer_organizations",
      "employer_members",
      "featured_listings",
      "job_opportunities",
      "profiles",
      "applications",
      "interviews",
      "resumes",
      "job_reports",
    ]) {
      expect(sql).not.toMatch(
        new RegExp(`(CREATE|ALTER) TABLE public\\.${table}\\b`, "i")
      );
    }
    expect(sql).not.toMatch(/storage\.objects/i);
  });
});