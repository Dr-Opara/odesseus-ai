import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const HOLD_MIGRATION =
  "supabase/migrations/20261023000000_application_run_hold_category.sql";
const SNAPSHOT_MIGRATION =
  "supabase/migrations/20261024000000_application_snapshot_completeness.sql";

// The repository stores LF, but Windows checkouts (core.autocrlf) may
// materialize CRLF; normalize so the file regexes below stay line-ending
// agnostic without altering the content under test.
const hold = readFileSync(path.join(repoRoot, HOLD_MIGRATION), "utf8").replace(
  /\r\n/g,
  "\n"
);
const snapshot = readFileSync(path.join(repoRoot, SNAPSHOT_MIGRATION), "utf8").replace(
  /\r\n/g,
  "\n"
);

const runner = readFileSync(path.join(repoRoot, "src/lib/apply/runner.ts"), "utf8").replace(
  /\r\n/g,
  "\n"
);

/** Start of the finalization RPC body — everything asserted about ordering
 *  and charging must live after it, not in the file's header comments. */
const RPC_HEAD = "CREATE OR REPLACE FUNCTION public.odesseus_finalize_application";

describe("application run hold category migration (Phase 2G)", () => {
  it("is additive: it never drops or rewrites a historical column or row", () => {
    expect(hold).not.toMatch(/^DROP TABLE/i);
    expect(hold).not.toMatch(/^DROP COLUMN/i);
    expect(hold).not.toMatch(/^DELETE FROM/i);
    expect(hold).not.toMatch(/^UPDATE public\./im);
    // The status/stop_reason pair the product already shipped is untouched:
    // stop_reason is only ever *read* by the new code, never redefined.
    expect(hold).not.toMatch(/status_check/);
    expect(hold).not.toMatch(/ALTER COLUMN (status|stop_reason)/i);
  });

  it("adds hold_category as nullable text with IF NOT EXISTS", () => {
    expect(hold).toMatch(
      /ALTER TABLE public\.application_runs\n\s*ADD COLUMN IF NOT EXISTS hold_category text;/
    );
  });

  it("constrains the category to a closed, evidence-shaped domain", () => {
    expect(hold).toMatch(/ADD CONSTRAINT application_runs_hold_category_check/);
    for (const category of [
      "captcha_required",
      "mfa_required",
      "sensitive_question",
      "insufficient_funds",
      "unsupported_flow",
      "unverified_submission",
      "needs_review",
    ]) {
      expect(hold).toContain(`'${category}'`);
    }
    // A category meaning "we got past a CAPTCHA" must not be addable later
    // without this test failing first.
    expect(hold).not.toMatch(/bypass|evade|auto.?solve|defeat/i);
  });

  it("enforces the iff invariant in a BEFORE trigger, not in application code", () => {
    expect(hold).toMatch(
      /CREATE OR REPLACE FUNCTION odesseus_private\.sync_application_run_hold_category\(\)\s*\n\s*RETURNS TRIGGER/
    );
    expect(hold).toMatch(
      /CREATE TRIGGER trg_application_runs_hold_category\n\s*BEFORE INSERT OR UPDATE ON public\.application_runs/
    );
    // Non-paused runs are cleared; paused runs with no category default to
    // needs_review. A missing branch here is a stale-value bug.
    expect(hold).toMatch(/if new\.status is distinct from 'needs_user' then\s*\n\s*new\.hold_category := null;/);
    expect(hold).toMatch(
      /elsif new\.hold_category is null then\s*\n\s*new\.hold_category := 'needs_review';/
    );
  });

  it("pins a function search_path and stays out of the client-reachable surface", () => {
    expect(hold).toMatch(
      /SET search_path TO 'public', 'odesseus_private', 'pg_temp'/
    );
    // The trigger function is not a schema the anon/authenticated roles can
    // call directly, and the migration grants it to nobody outside the DB.
    expect(hold).not.toMatch(/GRANT EXECUTE ON FUNCTION odesseus_private\.sync_application_run_hold_category\(\) TO (anon|authenticated)/i);
    expect(hold).not.toMatch(/GRANT EXECUTE ON FUNCTION odesseus_private\.freeze_application_verification_evidence\(\) TO (anon|authenticated)/i);
  });

  it("indexes the paused-run hold queue the Application Agent and admin ops poll", () => {
    expect(hold).toMatch(
      /CREATE INDEX IF NOT EXISTS application_runs_hold_category_idx\n\s*ON public\.application_runs \(user_id, hold_category, created_at DESC\)\n\s*WHERE hold_category IS NOT NULL;/
    );
  });

  it("freezes verification evidence onto the application as write-once", () => {
    expect(hold).toMatch(
      /ALTER TABLE public\.applications\n\s*ADD COLUMN IF NOT EXISTS verification_evidence jsonb NOT NULL DEFAULT '\{\}'::jsonb;/
    );
    expect(hold).toMatch(
      /CREATE TRIGGER trg_freeze_application_verification\n\s*BEFORE UPDATE OF verification_evidence ON public\.applications/
    );
    // Write-once means: once non-empty, the old value wins. Silently allowing
    // the new value through is the bug this trigger exists to prevent.
    expect(hold).toMatch(
      /if old\.verification_evidence <> '\{\}'::jsonb\s*\n\s*and new\.verification_evidence is distinct from old\.verification_evidence then\s*\n\s*new\.verification_evidence := old\.verification_evidence;/
    );
  });
});

describe("the runner writes hold_category on every run status transition", () => {
  it("derives the TypeScript domain from a single exported constant", () => {
    // A second, hand-maintained copy of the domain is how a category ends up
    // accepted in TypeScript and rejected by the CHECK constraint at runtime.
    expect(runner).toMatch(
      /export const APPLICATION_HOLD_CATEGORIES = \[([\s\S]*?)\] as const;/
    );
    expect(runner).toMatch(
      /export type ApplicationHoldCategory = \(typeof APPLICATION_HOLD_CATEGORIES\)\[number\];/
    );
  });

  it("sets the category whenever a run pauses and clears it on every exit", () => {
    // Each needs_user write carries a category; every non-paused transition
    // writes an explicit null rather than relying on the trigger to clean up.
    const pauseWrites = runner.match(/hold_category: (?!null)\S+/g) ?? [];
    const clearedWrites = runner.match(/hold_category: null/g) ?? [];

    expect(pauseWrites.length).toBeGreaterThan(0);
    expect(clearedWrites.length).toBeGreaterThan(0);

    for (const write of pauseWrites) {
      expect(write).not.toMatch(/undefined/);
    }
  });

  it("classifies the human gate at the point of evidence, not from prose", () => {
    // pageHasHumanGate returns the category alongside the sentence so CAPTCHA
    // vs MFA is decided where the DOM was inspected. Re-parsing the English
    // later is how the two get confused.
    expect(runner).toMatch(
      /async function pageHasHumanGate\(page: Page\): Promise<\{ reason: string; category: ApplicationHoldCategory \} \| null>/
    );
    expect(runner).toMatch(/hold_category: gate\.category,/);
  });

  it("treats an unrecognised pause as needs_review rather than guessing a cause", () => {
    const classifyBody = runner.slice(
      runner.indexOf("export function classifyHoldReason"),
      runner.indexOf("type FieldDescriptor")
    );
    expect(classifyBody).toMatch(/return "needs_review";\s*\}\s*$/);
  });
});

describe("application snapshot completeness migration (Phase 2H/2I)", () => {
  it("is additive: it never drops or rewrites a historical column or row", () => {
    expect(snapshot).not.toMatch(/^DROP TABLE/i);
    expect(snapshot).not.toMatch(/^DROP COLUMN/i);
    expect(snapshot).not.toMatch(/^DELETE FROM/i);
    // Historical applications are deliberately not backfilled: guessing a
    // source resume or a tailoring version would be worse than a visible null.
    expect(snapshot).not.toMatch(/^UPDATE public\.applications/im);
    expect(snapshot).toMatch(/Historical applications are NOT backfilled/);
  });

  it("adds the resume content hash used to verify what was actually submitted", () => {
    expect(snapshot).toMatch(
      /ALTER TABLE public\.resumes\n\s*ADD COLUMN IF NOT EXISTS content_hash text;/
    );
  });

  it("adds the four snapshot linkage columns with on-delete-set-null references", () => {
    for (const column of [
      "source_resume_id uuid REFERENCES public.resumes(id) ON DELETE SET NULL",
      "tailoring_id uuid REFERENCES public.resume_tailorings(id) ON DELETE SET NULL",
      "tailoring_version integer",
      "agent_decision_id uuid REFERENCES public.application_agent_decisions(id) ON DELETE SET NULL",
    ]) {
      expect(snapshot).toContain(column);
    }
    expect(snapshot).toMatch(
      /ADD CONSTRAINT applications_tailoring_version_check\s*\n\s*CHECK \(tailoring_version IS NULL OR tailoring_version > 0\);/
    );
  });

  it("carries size_bytes, content_hash, is_master, and external_id into the frozen snapshot", () => {
    // The JD snapshot records the employer's external id so the job can be
    // re-identified; the resume snapshot records the bytes' hash.
    for (const key of [
      "'size_bytes', resume_row.size_bytes",
      "'content_hash', resume_row.content_hash",
      "'is_master', resume_row.is_master",
      "'external_id', job_row.external_id",
    ]) {
      expect(snapshot).toContain(key);
    }
  });

  it("refuses to finalize from any status a live run cannot be paused in", () => {
    // The terminal guard alone (failed/cancelled) left statuses like an
    // already-finalized-but-reset run able to be charged again. This is the
    // fail-closed allowlist.
    expect(snapshot).toMatch(
      /if v_run\.status not in \(\s*\n\s*'queued', 'preflight', 'running', 'needs_user', 'ready_to_submit', 'submitting'\s*\n\s*\) then/
    );
    expect(snapshot).toMatch(
      /if v_run\.status in \('failed', 'cancelled'\) then/
    );
  });

  it("keeps the idempotent no-recharge short-circuit ahead of every other guard", () => {
    // Order matters: 'submitted' is checked before the mode-mismatch and
    // status guards so a retry always returns already_finalized with 0 debit
    // no matter what mode it passes.
    const body = snapshot.slice(snapshot.indexOf(RPC_HEAD));
    const submittedGuard = body.indexOf("if v_run.status = 'submitted' then");
    const modeGuard = body.indexOf("if v_mode <> v_run.execution_mode then");
    const statusGuard = body.indexOf("if v_run.status in ('failed', 'cancelled') then");

    expect(submittedGuard).toBeGreaterThan(-1);
    expect(submittedGuard).toBeLessThan(modeGuard);
    expect(submittedGuard).toBeLessThan(statusGuard);
    expect(body).toMatch(/return query select v_application_id, v_run\.id, true, 0;/);
  });

  it("reads the rate from pricing_prices and never hardcodes a money literal", () => {
    const body = snapshot.slice(snapshot.indexOf(RPC_HEAD));
    // 39 / 99 live in pricing_prices; a literal here is drift waiting to ship.
    expect(body).not.toMatch(/\b(39|99|49|199)\b\s*(?:,\s*integer|\*\s*100)/);
    expect(body).toMatch(/from public\.pricing_prices pr/);
    expect(body).toMatch(/and pr\.market_key = 'USD_US'/);
  });

  it("pins only an AUTO_APPLY agent decision as the authorising decision", () => {
    // A RULE_MISMATCH or AGENT_PAUSED log entry is not authorisation to
    // submit, so it must never be recorded as the decision behind one.
    expect(snapshot).toMatch(/and d\.decision = 'AUTO_APPLY'/);
  });

  it("guards the applicant-influenced tailoring_id before casting it to uuid", () => {
    // parsed_data is applicant-controlled JSON. A malformed tailoring_id must
    // be ignored, not allowed to abort settlement and lose the charge record.
    expect(snapshot).toMatch(
      /~ '\^\[0-9a-fA-F\]\{8\}-\[0-9a-fA-F\]\{4\}-\[0-9a-fA-F\]\{4\}-\[0-9a-fA-F\]\{4\}-\[0-9a-fA-F\]\{12\}\$'/
    );
    expect(snapshot).toMatch(/then \(r\.parsed_data ->> 'tailoring_id'\)::uuid/);
  });

  it("copies the evidence bundle onto the application and clears the run's hold", () => {
    const body = snapshot.slice(snapshot.indexOf(RPC_HEAD));
    expect(body).toMatch(/verification_evidence = v_evidence/);
    // The run leaves needs_user here, so its category must go with it.
    expect(body).toMatch(/set status = 'submitted',[\s\S]*?hold_category = null,/);
  });

  it("keeps the finalization RPC out of the client-reachable surface", () => {
    expect(snapshot).toMatch(
      /REVOKE ALL ON FUNCTION public\.odesseus_finalize_application\(uuid, uuid, text, text, text\) FROM PUBLIC;/
    );
    expect(snapshot).toMatch(
      /REVOKE ALL ON FUNCTION public\.odesseus_finalize_application\(uuid, uuid, text, text, text\) FROM anon;/
    );
    expect(snapshot).toMatch(
      /REVOKE ALL ON FUNCTION public\.odesseus_finalize_application\(uuid, uuid, text, text, text\) FROM authenticated;/
    );
    expect(snapshot).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.odesseus_finalize_application\(uuid, uuid, text, text, text\) TO postgres, service_role;/
    );
  });
});
