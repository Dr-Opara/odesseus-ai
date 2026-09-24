import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIGRATION =
  "supabase/migrations/20260925000000_apply_wallet_finalization.sql";
const sql = readFileSync(path.join(repoRoot, MIGRATION), "utf8");

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

    // App catalog: 49¢ standard / 199¢ smart.
    expect(catalog).toMatch(/standard: \{[\s\S]*?amountCents: 49/);
    expect(catalog).toMatch(/smart: \{[\s\S]*?amountCents: 199/);
    // DB reference prices: contract migration seeds the same cents.
    expect(contract).toMatch(/'candidate_standard_apply'.*?49/);
    expect(contract).toMatch(/'candidate_smart_apply'.*?199/);
    // The finalization RPC documents/derives the same rates from those rows.
    expect(sql).toMatch(/49/);
    expect(sql).toMatch(/199/);
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