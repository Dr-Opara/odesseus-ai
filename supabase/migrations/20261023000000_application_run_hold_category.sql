-- Structured hold classification for application_runs (Phase 2G). Additive;
-- does not rename or remove the existing status/stop_reason columns or
-- values, so no historical row or in-flight caller is affected.
--
-- application_runs.status already distinguishes queued/preflight/running/
-- needs_user/ready_to_submit/submitting/submitted/failed/cancelled, but every
-- kind of "needs_user" pause (CAPTCHA, MFA/login, a sensitive question, an
-- insufficient wallet balance, an unrecognized ATS form, an unverified
-- submission) collapsed into the same status with only a free-text
-- stop_reason. Admin ops and the Application Agent both need to tell these
-- apart without parsing prose. hold_category is that structured signal,
-- populated by the application code (src/lib/apply/runner.ts) alongside the
-- existing stop_reason at every needs_user transition; it is null whenever
-- status is not needs_user.
--
-- The domain is deliberately narrow and evidence-shaped. Every value is a
-- thing a run can actually observe about the employer's page or about our own
-- wallet; none of them is a judgement about the candidate:
--
--   captcha_required      a CAPTCHA / human-verification step was detected.
--                         Odesseus stops and asks the human. It never tries to
--                         solve or route around one.
--   mfa_required          a login, one-time code, or second-factor step was
--                         detected.
--   sensitive_question    at least one question the Answer Vault classified as
--                         sensitive (clearance, work authorization, salary, …)
--                         needs the applicant's own answer.
--   insufficient_funds    the submission was verified but the wallet could not
--                         cover the negotiated rate. Nothing was recorded.
--   unsupported_flow      the page exposes no control Odesseus can identify as
--                         the next or final step.
--   unverified_submission the submit action completed but no success
--                         confirmation was found. No credit is charged; the
--                         candidate is asked to look at the live browser.
--   needs_review          anything else that needs the applicant: an unknown
--                         question, a contact detail we have no verified value
--                         for, or any other manual input. This is also the
--                         database's own default for a paused run, so the column
--                         is never null while a run is waiting on a human.

ALTER TABLE public.application_runs
  ADD COLUMN IF NOT EXISTS hold_category text;

ALTER TABLE public.application_runs
  DROP CONSTRAINT IF EXISTS application_runs_hold_category_check;

ALTER TABLE public.application_runs
  ADD CONSTRAINT application_runs_hold_category_check
  CHECK (
    hold_category IS NULL
    OR hold_category IN (
      'captcha_required',
      'mfa_required',
      'sensitive_question',
      'insufficient_funds',
      'unsupported_flow',
      'unverified_submission',
      'needs_review'
    )
  );

COMMENT ON COLUMN public.application_runs.hold_category IS
  'Structured reason the run is paused in needs_user status (captcha_required, mfa_required, sensitive_question, insufficient_funds, unsupported_flow, unverified_submission, needs_review). Null whenever status is not needs_user.';

-- ---------------------------------------------------------------------------
-- The invariant: hold_category IS NOT NULL if and only if status =
-- 'needs_user'. Application code sets the category when it pauses a run and
-- clears it when the run resumes, but code is not the guarantee — a future
-- caller, an admin, or a workflow retry that forgets the field would otherwise
-- leave a stale category on a run that is running or already terminal, and
-- every consumer of this column (the dashboard, the Application Agent, admin
-- ops) would then be reading a hold reason for a run that is not on hold.
-- Enforcing it in a BEFORE trigger makes that unrepresentable for every writer,
-- including the service role.
--
-- A paused run with no category from the caller is recorded as needs_review
-- rather than left null: "waiting on a human" is exactly what that value
-- means, and a total function is one a query can rely on without coalesce().
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION odesseus_private.sync_application_run_hold_category()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
begin
  if new.status is distinct from 'needs_user' then
    new.hold_category := null;
  elsif new.hold_category is null then
    new.hold_category := 'needs_review';
  end if;

  return new;
end;
$function$;

COMMENT ON FUNCTION odesseus_private.sync_application_run_hold_category() IS
  'Enforces hold_category IS NOT NULL iff status = needs_user, for every writer.';

DROP TRIGGER IF EXISTS trg_application_runs_hold_category ON public.application_runs;

CREATE TRIGGER trg_application_runs_hold_category
  BEFORE INSERT OR UPDATE ON public.application_runs
  FOR EACH ROW
  EXECUTE FUNCTION odesseus_private.sync_application_run_hold_category();

-- Paused runs are what the Application Agent and admin ops poll for, so the
-- index is on the pair rather than the category alone: answering "what is this
-- user's agent blocked on right now" is the query that has to stay fast.
CREATE INDEX IF NOT EXISTS application_runs_hold_category_idx
  ON public.application_runs (user_id, hold_category, created_at DESC)
  WHERE hold_category IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Immutable verification evidence on the application row itself.
--
-- odesseus_finalize_application already records confirmation text, timestamps
-- and a JSONB evidence bundle on the *run*. A run row is mutable: a retry, a
-- resume, or a later manual pass can rewrite submission_evidence. The
-- historical application may not move, so the bundle is copied onto the
-- application at the instant it is finalized and never updated afterwards (the
-- freeze is write-once, enforced by the trigger below).
-- ---------------------------------------------------------------------------

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS verification_evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.applications.verification_evidence IS
  'Frozen copy of the submission-verification evidence captured by odesseus_finalize_application (confirmation detected, before/after URLs, execution mode, rate charged, attempt number). Write-once: it cannot change after the application is finalized.';

CREATE OR REPLACE FUNCTION odesseus_private.freeze_application_verification_evidence()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
begin
  -- Write-once, mirroring how job_snapshot/resume_snapshot already behave:
  -- once the bundle is non-empty it is frozen and a later update cannot
  -- rewrite history. An application that has not been finalized yet (status
  -- 'applied' is only set by the finalization RPC, so this is belt-and-braces)
  -- keeps whatever the caller supplied.
  if old.verification_evidence <> '{}'::jsonb
     and new.verification_evidence is distinct from old.verification_evidence then
    new.verification_evidence := old.verification_evidence;
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_freeze_application_verification ON public.applications;

CREATE TRIGGER trg_freeze_application_verification
  BEFORE UPDATE OF verification_evidence ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION odesseus_private.freeze_application_verification_evidence();
