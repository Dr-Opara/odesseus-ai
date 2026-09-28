import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIGRATION =
  "supabase/migrations/20260925000000_apply_wallet_finalization.sql";
// The repository stores LF, but Windows checkouts (core.autocrlf) may
// materialize CRLF; make the file regexes and statement splitting
// line-ending agnostic without altering the content under test.
const sql = readFileSync(path.join(repoRoot, MIGRATION), "utf8").replace(/\r\n/g, "\n");

/** Executable statements only (comments stripped) for "not built" checks. */
function executableStatements(source: string): string[] {
  return (source.match(/^(?!--).+/gm) ?? []).map((line) => line.trim());
}

describe("apply wallet finalization migration (Phase 3 backend slice)", () => {
  it("is additive: no table/column drops, no deletions, no data deletes", () => {
    expect(sql).not.toMatch(/^DROP TABLE/i);
    expect(sql).not.toMatch(/^DROP COLUMN/i);
    expect(sql).not.toMatch(/^DELETE FROM/i);
    expect(sql).not.toMatch(/^DROP DATABASE/i);
    // The one intended constraint change is a drop-and-readd of the
    // execution_mode CHECK, documented right next to its replacement.
    expect(sql).toMatch(/^ALTER TABLE public\.application_runs\n\s*DROP CONSTRAINT application_runs_execution_mode_check;/m);
  });

  it("widens application_runs.execution_mode to the {standard, smart} contract domain", () => {
    expect(sql).toMatch(/ALTER TABLE public\.application_runs\n\s*ADD CONSTRAINT application_runs_execution_mode_check\n\s*CHECK \(execution_mode IN \('standard'::text, 'smart'::text\)\)/);
    expect(sql).toMatch(/ALTER TABLE public\.application_runs\n\s*ALTER COLUMN execution_mode SET DEFAULT 'standard';/);
    // Legacy 'assisted' rows are migrated to 'standard' before the new
    // constraint applies, so the migration runs cleanly on any dev data.
    expect(sql).toMatch(/UPDATE public\.application_runs\nSET execution_mode = 'standard'\nWHERE execution_mode = 'assisted';/);
  });

  it("adds the mode-aware atomic finalization RPC as the new charge path", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.odesseus_finalize_application \(\n\s*p_run_id\s+uuid,/);
    expect(sql).toMatch(/p_mode\s+text,/);
    expect(sql).toMatch(/RETURNS TABLE \(\n\s*application_id\s+uuid,\n\s*run_id\s+uuid,\n\s*already_finalized\s+boolean,\n\s*amount_debited_cents\s+integer\n\s*\)/);
  });

  it("keeps the wallet debit atomic with the application upsert and idempotent per run", () => {
    // Debit is a credit_transactions insert keyed on the record-unique
    // external_reference, with on-conflict no-op for retries.
    expect(sql).toMatch(/'application:' \|\| p_run_id::text/);
    expect(sql).toMatch(/on conflict \(external_reference\) do nothing/i);
    // amount_cents = abs(delta) — the signed delta is the negative rate.
    expect(sql).toMatch(/-v_rate_cents,/);
    expect(sql).toMatch(/amount_cents, external_reference, metadata/);
    // Successful runs short-circuit to already_finalized with no re-charge.
    expect(sql).toMatch(/if v_run\.status = 'submitted' then/);
  });

  it("pins the charge path to the mode selectable from the negotiated reference prices", () => {
    // The RPC maps the mode to its product key; it never hardcodes a money
    // literal, so the debited amount always equals what /api/pricing serves.
    expect(sql).toMatch(/'candidate_standard_apply'/);
    expect(sql).toMatch(/'candidate_smart_apply'/);
    expect(sql).toMatch(/v_product_key/);
    expect(sql).toMatch(/pr\.amount_minor/);
    expect(sql).toMatch(/pr\.market_key = 'USD_US'/);
  });

  it("keeps apply rates in lockstep across app catalog and DB reference prices", () => {
    const catalog = readFileSync(
      path.join(repoRoot, "src/lib/billing/catalog.ts"),
      "utf8"
    );
    const contract = readFileSync(
      path.join(repoRoot, "supabase/migrations/20260924000000_current_pricing_contract.sql"),
      "utf8"
    );

    // App catalog: the live rate for each mode. Anchored on the property name
    // and a digit boundary so `amountCents: 3900` or the featured tier's
    // `amountCents: 4900` cannot satisfy the assertion vacuously.
    expect(catalog).toMatch(/standard:\s*\{[^}]*?amountCents:\s*39\s*[,}]/);
    expect(catalog).toMatch(/smart:\s*\{[^}]*?amountCents:\s*99\s*[,}]/);
    // The contract migration seeded the original 49/199 before the rate moved
    // to 39/99; the *current* rate is whatever the last migration to touch
    // those rows set, so assert the move is recorded rather than the seed.
    expect(contract).toMatch(/'candidate_standard_apply'.*?49/);
    expect(contract).toMatch(/'candidate_smart_apply'.*?199/);
    const current = readFileSync(
      path.join(
        repoRoot,
        "supabase/migrations/20261016000000_live_products_and_guests.sql"
      ),
      "utf8"
    );
    // The move to 39/99 is an UPDATE ... SET amount_minor = <rate> WHERE
    // product_key = ... , so the rate precedes the key in the statement.
    expect(current).toMatch(
      /amount_minor = 39,[\s\S]{0,120}?product_key = 'candidate_standard_apply' AND market_key = 'USD_US';/
    );
    expect(current).toMatch(
      /amount_minor = 99,[\s\S]{0,120}?product_key = 'candidate_smart_apply' AND market_key = 'USD_US';/
    );
    // The finalization RPC never hardcodes a money literal: it resolves the
    // rate from the reference price row, so it follows the migration above.
    expect(sql).not.toMatch(/v_rate_cents\s*:=\s*\d/);
    expect(sql).toMatch(/pr\.amount_minor/);
  });

  it("exposes the new RPC only to postgres and service_role, never to browser roles", () => {
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.odesseus_finalize_application(uuid, uuid, text, text, text) FROM PUBLIC;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.odesseus_finalize_application(uuid, uuid, text, text, text) FROM anon;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.odesseus_finalize_application(uuid, uuid, text, text, text) FROM authenticated;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.odesseus_finalize_application(uuid, uuid, text, text, text) TO postgres, service_role;");
  });

  it("does not touch the deprecated 4-arg legacy RPC (preserved byte-for-byte)", () => {
    // Comments in the header may describe the legacy function; executable
    // statements must never create/replace/alter it.
    const statements = executableStatements(sql);
    expect(
      statements.some((s) =>
        /CREATE OR REPLACE FUNCTION public\.odesseus_finalize_successful_application/.test(s)
      )
    ).toBe(false);
    expect(statements.some((s) => /odesseus_finalize_successful_application/.test(s))).toBe(false);
  });

  it("leaves Live products and any employer-product work untouched", () => {
    expect(sql).not.toMatch(/candidate_live|interview_passes|live_unlimited/i);
    expect(sql).not.toMatch(/employer_|featured_|recruiter_/i);
  });
});

describe("apply finalization RPC as last redefined (Phase 2I)", () => {
  const latest = readFileSync(
    path.join(
      repoRoot,
      "supabase/migrations/20261024000000_application_snapshot_completeness.sql"
    ),
    "utf8"
  ).replace(/\r\n/g, "\n");

  it("keeps the same signature and the same idempotent charge path", () => {
    expect(latest).toMatch(
      /CREATE OR REPLACE FUNCTION public\.odesseus_finalize_application \(\n\s*p_run_id\s+uuid,/
    );
    expect(latest).toMatch(/'application:' \|\| p_run_id::text/);
    expect(latest).toMatch(/on conflict \(external_reference\) do nothing/i);
    // The replay short-circuit must still precede the mode guard, so a retry of
    // a settled run can never re-charge whatever mode it is passed.
    expect(latest.indexOf("if v_run.status = 'submitted' then")).toBeLessThan(
      latest.indexOf("execution mode mismatch")
    );
  });

  it("still resolves the rate from the reference price, never a literal", () => {
    expect(latest).toMatch(/pr\.amount_minor/);
    expect(latest).toMatch(/pr\.market_key = 'USD_US'/);
    expect(latest).not.toMatch(/v_rate_cents\s*:=\s*\d+/);
  });

  it("refuses to charge a run that ended without a verified submission", () => {
    expect(latest).toMatch(
      /if v_run\.status in \('failed', 'cancelled'\) then[\s\S]{0,200}?raise exception/
    );
    // Every remaining status is one a live run can legitimately pause in; a
    // status outside that set is refused rather than charged.
    expect(latest).toMatch(
      /if v_run\.status not in \(\s*'queued', 'preflight', 'running', 'needs_user', 'ready_to_submit', 'submitting'\s*\) then/
    );
  });

  it("still requires a real confirmation message", () => {
    expect(latest).toMatch(
      /if p_confirmation_text is null or length\(trim\(p_confirmation_text\)\) = 0 then/
    );
  });

  it("keeps the RPC off every browser role", () => {
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(latest).toContain(
        `REVOKE ALL ON FUNCTION public.odesseus_finalize_application(uuid, uuid, text, text, text) FROM ${role};`
      );
    }
    expect(latest).toContain(
      "GRANT EXECUTE ON FUNCTION public.odesseus_finalize_application(uuid, uuid, text, text, text) TO postgres, service_role;"
    );
  });
});