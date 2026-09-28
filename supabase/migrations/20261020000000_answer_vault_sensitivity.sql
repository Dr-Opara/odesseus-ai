-- Answer Vault sensitivity classification + equivalence safeguards
-- (Phase 2E). Additive migration; local stack. Nothing historical is
-- rewritten.
--
-- application_answer_vault already existed (baseline) and already excluded
-- sensitive questions from ever being written to it. This adds the explicit
-- record spec requires rather than relying on that exclusion being implicit:
--
--   * sensitivity_classification — records what the vault write-path
--     actually classified this entry as at write time. Constrained to
--     'standard' only: a row that somehow carries 'sensitive' would mean the
--     write-path safeguard in src/app/api/apply/[id]/resolve/route.ts failed,
--     and the constraint makes that fail loudly at the database instead of
--     silently persisting a sensitive answer for reuse.
--   * normalized_intent — the canonical form (src/lib/apply/answer-vault.ts,
--     normalizeQuestionIntent()) used for equivalence matching, so a
--     differently-worded but materially identical question can reuse an
--     approved answer without a raw-substring coincidence deciding it.
--   * approved_at — the moment the applicant approved this answer for reuse,
--     distinct from created_at/updated_at (which move on every reuse).

ALTER TABLE public.application_answer_vault
  ADD COLUMN IF NOT EXISTS normalized_intent text,
  ADD COLUMN IF NOT EXISTS sensitivity_classification text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

ALTER TABLE public.application_answer_vault
  ADD CONSTRAINT application_answer_vault_sensitivity_classification_check
  CHECK (sensitivity_classification = 'standard');

-- Existing rows were all written under the old, purely-exclusionary logic
-- (no 'sensitive' category ever reached this table), so backfilling their
-- approval moment to updated_at is a reasonable approximation rather than an
-- unresolved NULL.
UPDATE public.application_answer_vault
SET approved_at = updated_at
WHERE approved_at IS NULL;

CREATE INDEX IF NOT EXISTS application_answer_vault_normalized_intent_idx
  ON public.application_answer_vault (user_id, normalized_intent)
  WHERE normalized_intent IS NOT NULL;
