-- Candidate profile + onboarding backend extensions (Phase 2A). Additive
-- migration; local stack. Nothing historical is rewritten.
--
-- Three additive changes, all owner-scoped private candidate data:
--
--   1. profiles.onboarding_completed_at — the existing onboarding_completed
--      boolean has no timestamp. A trigger stamps it the moment the boolean
--      first flips true, so the app never has to remember to set it and a
--      client cannot backdate or clear it by patching the column directly.
--
--   2. public.candidate_work_authorization — a dedicated table for the
--      applicant-declared facts the spec requires to be structured rather than
--      folded into job_preferences.work_authorization (a free-text column) and
--      sponsorship_needed (a single boolean). These answers must come from the
--      applicant, never inferred, so the table has no default-true/false
--      guess: every boolean defaults to false (the safest "unknown") and only
--      the applicant's own upsert (owner-only RLS) ever writes it.
--
--   3. job_preferences — additive columns for the exclusion lists, the
--      three-way work-arrangement toggle, and relocation preference the spec
--      asks for. remote_only is left exactly as-is (existing discovery
--      prefilter code reads it); the new booleans are the more precise surface
--      new code should prefer.

-- ---------------------------------------------------------------------------
-- 1. onboarding_completed_at
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

CREATE OR REPLACE FUNCTION odesseus_private.stamp_onboarding_completed_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
begin
  if new.onboarding_completed
     and (tg_op = 'INSERT' or old.onboarding_completed is distinct from true)
     and new.onboarding_completed_at is null then
    new.onboarding_completed_at := now();
  end if;

  if not new.onboarding_completed then
    new.onboarding_completed_at := null;
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_profiles_stamp_onboarding ON public.profiles;
CREATE TRIGGER trg_profiles_stamp_onboarding
  BEFORE INSERT OR UPDATE OF onboarding_completed ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION odesseus_private.stamp_onboarding_completed_at();

-- Backfill: existing completed profiles get updated_at as a reasonable
-- approximation rather than a NULL that would otherwise never resolve.
UPDATE public.profiles
SET onboarding_completed_at = updated_at
WHERE onboarding_completed = true
  AND onboarding_completed_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. candidate_work_authorization
-- ---------------------------------------------------------------------------

CREATE TABLE public.candidate_work_authorization (
  user_id                        uuid NOT NULL,
  country_code                   text,
  authorized_without_sponsorship boolean NOT NULL DEFAULT false,
  sponsorship_required            boolean NOT NULL DEFAULT false,
  relocation_allowed              boolean NOT NULL DEFAULT false,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_work_authorization_pkey PRIMARY KEY (user_id),
  CONSTRAINT candidate_work_authorization_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT candidate_work_authorization_country_code_check
    CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  -- An applicant cannot simultaneously declare "authorized without
  -- sponsorship" and "sponsorship required" for the same country.
  CONSTRAINT candidate_work_authorization_not_contradictory
    CHECK (NOT (authorized_without_sponsorship AND sponsorship_required))
);

COMMENT ON TABLE public.candidate_work_authorization IS
  'Applicant-declared work authorization facts. Every field is set only by the applicant''s own upsert (RLS owner-only) — never inferred by the agent or the optimizer.';

ALTER TABLE public.candidate_work_authorization ENABLE ROW LEVEL SECURITY;

CREATE POLICY "candidate_work_authorization_select_own" ON public.candidate_work_authorization
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "candidate_work_authorization_insert_own" ON public.candidate_work_authorization
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "candidate_work_authorization_update_own" ON public.candidate_work_authorization
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "candidate_work_authorization_delete_own" ON public.candidate_work_authorization
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON TABLE public.candidate_work_authorization FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.candidate_work_authorization TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.candidate_work_authorization TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 3. job_preferences additive columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.job_preferences
  ADD COLUMN IF NOT EXISTS remote_allowed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS hybrid_allowed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS onsite_allowed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS excluded_companies text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS excluded_titles text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS relocation_preference text;

ALTER TABLE public.job_preferences
  ADD CONSTRAINT job_preferences_relocation_preference_check
  CHECK (relocation_preference IS NULL OR relocation_preference IN ('open', 'not_open', 'case_by_case'));

COMMENT ON COLUMN public.job_preferences.remote_allowed IS
  'Explicit three-way work-arrangement toggle. remote_only is kept for the existing discovery prefilter; new code should prefer remote_allowed/hybrid_allowed/onsite_allowed.';
COMMENT ON COLUMN public.job_preferences.excluded_companies IS
  'Company names the candidate never wants surfaced or auto-applied to.';
COMMENT ON COLUMN public.job_preferences.excluded_titles IS
  'Title substrings the candidate never wants surfaced or auto-applied to.';
COMMENT ON COLUMN public.job_preferences.relocation_preference IS
  'open | not_open | case_by_case. NULL means the applicant has not stated a preference.';
