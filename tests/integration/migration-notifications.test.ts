import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CANDIDATE_NOTIFICATION_TYPES,
  CRITICAL_CANDIDATE_NOTIFICATION_TYPES,
  EMPLOYER_NOTIFICATION_TYPES,
  NOTIFICATION_CATALOG,
  NOTIFICATION_TYPES,
} from "@/lib/notifications/catalog";
import { INTERVIEW_REMINDER_MINUTES } from "@/lib/notifications/reminders";
import { WALLET_LOW_THRESHOLD_CENTS } from "@/lib/notifications/email";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIGRATION = "supabase/migrations/20261029000000_notifications.sql";
const M8_PREFS = "supabase/migrations/20261002000000_notification_preferences.sql";

const read = (relative: string) =>
  readFileSync(path.join(repoRoot, relative), "utf8").replace(/\r\n/g, "\n");

const sql = read(MIGRATION);

/** Body of a function, from its declaration to the end of its body. */
function functionBody(declaration: string, body = sql): string {
  const start = body.indexOf(declaration);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = body.indexOf("\n$function$;", start);
  expect(end).toBeGreaterThan(start);
  return body.slice(start, end);
}

/** Quoted tokens inside a `CHECK (x IN (...))` list captured by `pattern`. */
function listTokens(pattern: RegExp, body = sql): string[] {
  const m = body.match(pattern);
  expect(m, `pattern ${pattern} did not match`).not.toBeNull();
  const content = m?.[1] ?? "";
  return [...content.matchAll(/'([A-Za-z0-9_]+)'/g)].map((x) => x[1]);
}

describe("20261029000000_notifications.sql <-> TS contract", () => {
  it("declares exactly the catalog's notification types, in both directions", () => {
    const sqlTypes = listTokens(/CHECK \(notification_type IN \(\s*([\s\S]*?)\)\)/);
    expect(sqlTypes).toHaveLength(35);
    expect([...sqlTypes].sort()).toEqual([...NOTIFICATION_TYPES].sort());
    for (const type of CANDIDATE_NOTIFICATION_TYPES) expect(sqlTypes).toContain(type);
    for (const type of EMPLOYER_NOTIFICATION_TYPES) expect(sqlTypes).toContain(type);
  });

  it("keeps the 24/11 candidate/employer split in the migration header", () => {
    expect(sql).toMatch(/-- Candidate catalog \(24\)/);
    expect(sql).toMatch(/-- Employer catalog \(11\)/);
  });

  it("pins the entity_type vocabulary the catalog and routes rely on", () => {
    expect(listTokens(/CHECK \(entity_type IN \(\s*([\s\S]*?)\)\)/)).toEqual([
      "application",
      "application_run",
      "job_opportunity",
      "interview",
      "credit_transaction",
      "employer_job",
      "employer_organization",
      "featured_listing",
      "account",
    ]);
  });

  it("pins the email_delivery_status lifecycle to none/skipped/queued/sent", () => {
    const statuses = listTokens(/CHECK \(email_delivery_status IN \(\s*([\s\S]*?)\)\)/);
    expect(statuses.sort()).toEqual(["none", "queued", "sent", "skipped"]);
  });

  it("flags exactly the same five critical candidate types in SQL and TS", () => {
    const criticalFn = functionBody(
      "CREATE OR REPLACE FUNCTION odesseus_private.notification_candidate_is_critical"
    );
    const sqlCritical = listTokens(/p_type in \(\s*([\s\S]*?)\);/, criticalFn).sort();
    expect(sqlCritical).toEqual([...CRITICAL_CANDIDATE_NOTIFICATION_TYPES].sort());
    expect(sqlCritical).toHaveLength(5);
  });

  it("maps every candidate type to the same channel the catalog does", () => {
    const channelFn = functionBody(
      "CREATE OR REPLACE FUNCTION odesseus_private.notification_candidate_channel"
    );
    const sqlMap = new Map(
      [...channelFn.matchAll(/when '([A-Z_]+)' then '([a-z_]+)'/g)].map((m) => [m[1], m[2]])
    );
    expect(sqlMap.size).toBe(CANDIDATE_NOTIFICATION_TYPES.length);
    for (const type of CANDIDATE_NOTIFICATION_TYPES) {
      expect(sqlMap.get(type)).toBe(NOTIFICATION_CATALOG[type].channel);
    }
  });

  it("maps every employer type to the same org channel the catalog does", () => {
    const channelFn = functionBody(
      "CREATE OR REPLACE FUNCTION odesseus_private.notification_employer_channel"
    );
    const sqlMap = new Map(
      [...channelFn.matchAll(/when '([A-Z_]+)' then '([a-z_]+)'/g)].map((m) => [m[1], m[2]])
    );
    expect(sqlMap.size).toBe(EMPLOYER_NOTIFICATION_TYPES.length);
    for (const type of EMPLOYER_NOTIFICATION_TYPES) {
      expect(sqlMap.get(type)).toBe(NOTIFICATION_CATALOG[type].channel);
    }
  });

  it("pins the $5.00 wallet low-balance threshold in both languages", () => {
    const thresholdFn = functionBody(
      "CREATE OR REPLACE FUNCTION odesseus_private.notification_wallet_low_threshold_cents"
    );
    expect(thresholdFn).toMatch(/select 500;/);
    expect(WALLET_LOW_THRESHOLD_CENTS).toBe(500);
  });

  it("pins the interviewer reminder windows to 24h and 1h in both languages", () => {
    const minutesFn = functionBody(
      "CREATE OR REPLACE FUNCTION odesseus_private.notification_interview_reminder_minutes"
    );
    expect(minutesFn).toMatch(/select array\[1440, 60\]::int\[\];/);
    expect([...INTERVIEW_REMINDER_MINUTES]).toEqual([1440, 60]);
  });

  it("pins the reminder check vocabulary and the (interview, window) uniqueness", () => {
    expect(listTokens(/CHECK \(reminder_type IN \(\s*([\s\S]*?)\)\)/)).toEqual(["1_day", "1_hour"]);
    expect(
      listTokens(/DEFAULT 'scheduled'\s+CHECK \(status IN \(\s*([\s\S]*?)\)\)/)
    ).toEqual(["scheduled", "fired", "cancelled"]);
    expect(sql).toMatch(/UNIQUE \(interview_id, reminder_type\)/);
  });

  it("deduplicates on (recipient_user_id, dedupe_key) via a partial unique index", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX notifications_recipient_dedupe_key[\s\S]*ON public\.notifications \(recipient_user_id, dedupe_key\)[\s\S]*WHERE dedupe_key IS NOT NULL;/
    );
  });

  it("never gives the browser role a table-level write on notifications", () => {
    expect(sql).toMatch(
      /REVOKE ALL ON TABLE public\.notifications FROM anon, authenticated;\nGRANT SELECT ON TABLE public\.notifications TO authenticated;\nGRANT UPDATE \(read_at\) ON TABLE public\.notifications TO authenticated;/
    );
    expect(sql).not.toMatch(
      /GRANT (INSERT|UPDATE|DELETE) ON TABLE public\.notifications TO authenticated;/
    );
  });

  it("denies every browser role outright on the reminder schedule", () => {
    expect(sql).toMatch(
      /CREATE POLICY "notification_reminders_deny_browser_access" ON public\.notification_reminders\n  FOR ALL TO anon, authenticated\n  USING \(false\)\n  WITH CHECK \(false\);/
    );
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.notification_reminders FROM anon, authenticated;/);
  });

  it("lets members read employer preferences but only owners write, with no DELETE", () => {
    expect(sql).toMatch(
      /GRANT SELECT, INSERT, UPDATE ON TABLE public\.employer_notification_preferences TO authenticated;/
    );
    expect(sql).not.toMatch(
      /GRANT DELETE ON TABLE public\.employer_notification_preferences TO authenticated;/
    );
    expect(sql).toMatch(/CREATE POLICY "employer_notification_preferences_select_member"/);
    expect(sql).toMatch(/CREATE POLICY "employer_notification_preferences_insert_admin_owner"/);
    expect(sql).toMatch(/CREATE POLICY "employer_notification_preferences_update_admin_owner"/);
  });

  it("enables RLS on the two new tables plus employer prefs, and M8 does the rest", () => {
    for (const table of [
      "public.notifications",
      "public.notification_reminders",
      "public.employer_notification_preferences",
    ]) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`));
    }
    const m8 = read(M8_PREFS);
    expect(m8).toMatch(/ALTER TABLE public\.notification_preferences ENABLE ROW LEVEL SECURITY;/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION odesseus_private\.record_notification[\s\S]*FROM PUBLIC/
    );
    expect(sql).toMatch(/FOR ALL TO anon, authenticated/);
  });

  it("is additive: creates only new tables and rewrites no historical rows", () => {
    expect(sql).not.toMatch(/^DROP TABLE/im);
    expect(sql).not.toMatch(/^ALTER TABLE .* DROP COLUMN/im);
    expect(sql).not.toMatch(/^DELETE FROM/im);
    expect(sql).not.toMatch(/^UPDATE public\./im);
    const withoutComments = sql.replace(/^--.*$/gm, "");
    expect(withoutComments.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });
});

describe("notification cron wiring", () => {
  const vercel = read("vercel.json");
  const crons = JSON.parse(vercel).crons as { path: string; schedule: string }[];

  it("runs the email drain every 15 minutes", () => {
    const cron = crons.find((c) => c.path === "/api/cron/process-notification-emails");
    expect(cron?.schedule).toBe("*/15 * * * *");
  });

  it("runs the reminder fire every 15 minutes", () => {
    const cron = crons.find((c) => c.path === "/api/cron/process-interview-reminders");
    expect(cron?.schedule).toBe("*/15 * * * *");
  });
});