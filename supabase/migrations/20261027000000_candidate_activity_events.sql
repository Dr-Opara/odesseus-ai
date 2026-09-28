-- Candidate activity events (Phase 2J).
--
-- The candidate dashboard needs one honest answer to "what has happened to my
-- job search". Today it does not have one:
--
--   * the activity feed is assembled at read time from
--     application_status_events, whose event_type domain includes
--     'email_detected' and 'calendar_detected'. That is a provider-integration
--     signal, and a dashboard that reads it inherits a dependency on somebody
--     having connected a mailbox. Phase 2J requires native Odesseus data only,
--     so the dashboard must not read that table.
--   * the counts beside it are computed in the route from a 5-row job fetch and
--     a 20-row application fetch, so "strong matches" is a count over at most
--     five rows and the pipeline is a count over at most twenty. Those are not
--     measurements of the candidate's search; they are measurements of how much
--     the page happened to fetch.
--
-- This table is the fix for the first problem, and the single event vocabulary
-- the aggregation layer reads for the second. It records what the system did,
-- as it did it, in the transaction that did it.
--
-- Design notes
-- ------------
--
-- * Every row is written by a trigger on the table the event describes. The
--   wallet is the reason: credit_transactions is inserted by roughly twenty
--   separate RPCs across the migration history. A service that remembered to
--   record "wallet charged" would eventually miss one, and a charge with no
--   activity row is exactly the kind of gap that makes a dashboard untrustworthy.
--   A trigger cannot be forgotten at a call site.
--
-- * Because each event is written by the insert or the transition that caused
--   it, the stream is idempotent by construction: replaying a function that
--   re-asserts the same value writes no second row. dedupe_key exists for the
--   one case that is not already unique -- applications are re-finalized on a
--   retry, which UPDATEs the existing row and can legitimately restamp
--   submitted_at.
--
-- * record_candidate_activity swallows its own errors. An activity feed must
--   never be able to fail an application submission or a wallet settlement; it
--   is a record of the work, not part of the work. Failures are raised as
--   warnings so they stay visible in the database log rather than vanishing.
--
-- * occurred_at is never read from a column called updated_at. Those columns
--   have a now() default and no trigger that maintains them, so they are frozen
--   at the value they had on INSERT -- a run's updated_at today is the moment
--   the run was created, not the moment anything changed. Feeding one of those
--   in here would date every event in a candidate's feed to the day they first
--   started looking, which is a plausible-looking feed that is simply wrong.
--   resume_tailorings.approved_at is unusable for the same reason: migration
--   20261020000000 sets it to updated_at rather than to a captured clock
--   reading, so it records when the draft was written, not when it was approved.
--   Only timestamps the code genuinely writes are used -- discovered_at,
--   created_at, submitted_at, scheduled_at, ended_at -- and everything else
--   falls back to the recorder's clock_timestamp(), which is the moment the
--   database actually observed the transition.
--
-- * There is no INSERT, UPDATE or DELETE policy. The candidate can read their
--   own history and cannot write to it, exactly like admin_audit_log: a
--   candidate who can insert their own "wallet topped up" row can invent money.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.candidate_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  title text NOT NULL,
  detail text,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  dedupe_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- The seventeen event types Phase 2J names. This is the whole vocabulary;
  -- a type nobody produces and nobody reads is a value that only widens the
  -- domain, which is the defect this milestone exists to fix.
  CONSTRAINT candidate_activity_events_event_type_check CHECK (
    event_type = ANY (ARRAY[
      'job_matched'::text,
      'job_saved'::text,
      'resume_uploaded'::text,
      'resume_optimized'::text,
      'application_queued'::text,
      'application_needs_review'::text,
      'application_needs_input'::text,
      'application_held'::text,
      'application_submitted'::text,
      'application_verified'::text,
      'application_failed'::text,
      'interview_added'::text,
      'mock_interview_completed'::text,
      'wallet_charged'::text,
      'wallet_topped_up'::text,
      'agent_paused'::text,
      'agent_resumed'::text
    ])
  ),

  -- Every event names the row it is about, so the feed can link to it without
  -- a second guess about which record produced which line.
  CONSTRAINT candidate_activity_events_entity_type_check CHECK (
    entity_type = ANY (ARRAY[
      'job_opportunity'::text,
      'resume'::text,
      'resume_tailoring'::text,
      'application_run'::text,
      'application'::text,
      'interview'::text,
      'credit_transaction'::text,
      'application_agent_settings'::text
    ])
  ),

  -- A feed line with no title is a blank line, and an unbounded title is a
  -- place to put an entire job description.
  CONSTRAINT candidate_activity_events_title_check CHECK (
    length(btrim(title)) > 0 AND length(title) <= 200
  ),
  CONSTRAINT candidate_activity_events_detail_check CHECK (
    detail IS NULL OR length(detail) <= 500
  ),
  CONSTRAINT candidate_activity_events_dedupe_key_check CHECK (
    dedupe_key IS NULL OR length(dedupe_key) <= 200
  )
);

COMMENT ON TABLE public.candidate_activity_events IS
  'Append-only record of what Odesseus did for a candidate, written by trigger '
  'in the transaction that did it. No INSERT/UPDATE/DELETE policy exists, so a '
  'candidate may read their own history but cannot write to it. Dashboard '
  'aggregation reads this table and native Odesseus rows only; it never reads '
  'external_signals or application_status_events email/calendar events, so the '
  'dashboard has no mailbox dependency.';

COMMENT ON COLUMN public.candidate_activity_events.event_type IS
  'Closed vocabulary of seventeen values. Kept in step with '
  'LIVE_ACTIVITY_EVENT_TYPES in src/lib/candidate/activity.ts by a test that '
  'compares the two sets in both directions.';

COMMENT ON COLUMN public.candidate_activity_events.title IS
  'Plain-language line shown in the activity feed, generated from the source '
  'row own fields. Stored rather than derived because a feed is a record of '
  'what happened, and the company and role on the row may change later.';

COMMENT ON COLUMN public.candidate_activity_events.occurred_at IS
  'When the thing happened, which is not always now: a match carries the '
  'discovery timestamp and a submission carries submitted_at.';

COMMENT ON COLUMN public.candidate_activity_events.dedupe_key IS
  'Optional uniqueness key, used only where the source row is not itself '
  'unique per event. Partial unique index below.';

COMMENT ON COLUMN public.candidate_activity_events.metadata IS
  'Structured facts behind the line, e.g. match_score, amount_cents, '
  'hold_category. Presentation such as currency formatting is the reader''s '
  'job, so the stored values are raw.';

-- Indexes -------------------------------------------------------------------

-- The feed itself: one candidate, newest first.
CREATE INDEX IF NOT EXISTS candidate_activity_events_user_recent_idx
  ON public.candidate_activity_events (user_id, occurred_at DESC, id DESC);

-- Per-type counts and filtered feeds (queue counts, wallet activity, prep).
CREATE INDEX IF NOT EXISTS candidate_activity_events_user_type_idx
  ON public.candidate_activity_events (user_id, event_type, occurred_at DESC);

-- Emits that could be attempted twice collapse to one row.
CREATE UNIQUE INDEX IF NOT EXISTS candidate_activity_events_dedupe_key_uniq
  ON public.candidate_activity_events (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.candidate_activity_events ENABLE ROW LEVEL SECURITY;

-- Read your own history. No write policy on purpose: the events are written by
-- SECURITY DEFINER triggers, and a forgeable activity stream is worth nothing.
CREATE POLICY candidate_activity_events_select_own
  ON public.candidate_activity_events
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON TABLE public.candidate_activity_events FROM anon;
REVOKE ALL ON TABLE public.candidate_activity_events FROM authenticated;
GRANT SELECT ON TABLE public.candidate_activity_events TO authenticated;
GRANT SELECT, INSERT ON TABLE public.candidate_activity_events TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The recorder
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION odesseus_private.record_candidate_activity (
  p_user_id uuid,
  p_event_type text,
  p_title text,
  p_detail text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT NULL,
  p_dedupe_key text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
begin
  -- No subject, no event. Every trigger below passes NEW.user_id, which is
  -- never null in these tables, so this is belt and braces rather than a
  -- branch that is expected to run.
  if p_user_id is null then
    return;
  end if;

  insert into public.candidate_activity_events (
    user_id, event_type, title, detail, entity_type, entity_id,
    occurred_at, dedupe_key, metadata
  )
  values (
    p_user_id,
    p_event_type,
    -- Truncated rather than rejected: an over-long company name is a cosmetic
    -- problem and must not fail the transaction that produced it.
    left(coalesce(nullif(btrim(p_title), ''), 'Activity'), 200),
    case when p_detail is null then null else left(p_detail, 500) end,
    coalesce(p_entity_type, 'application_agent_settings'),
    coalesce(p_entity_id, p_user_id),
    -- clock_timestamp, not now(): now() is the transaction timestamp, so every
    -- event written by one transaction would tie and the feed would fall back
    -- to ordering random uuids. The wall clock keeps the order of events inside
    -- a single transaction, which is the order they actually happened in.
    coalesce(p_occurred_at, clock_timestamp()),
    p_dedupe_key,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
exception
  when others then
    -- Deliberately swallowed. This runs inside wallet settlement, application
    -- finalization and Live session activation; a feed that can roll back a
    -- real application would be worse than a feed that misses a line. The
    -- warning keeps the failure visible in the database log.
    raise warning 'candidate_activity_events: % failed for % (%): %',
      'record_candidate_activity', p_user_id, p_event_type, sqlerrm;
end;
$function$;

COMMENT ON FUNCTION odesseus_private.record_candidate_activity(
  uuid, text, text, text, text, uuid, timestamptz, text, jsonb
) IS
  'The only writer of candidate_activity_events. Deliberately never raises: a '
  'missing feed line is a cosmetic defect, a failed submission is not.';

REVOKE ALL ON FUNCTION odesseus_private.record_candidate_activity(
  uuid, text, text, text, text, uuid, timestamptz, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION odesseus_private.record_candidate_activity(
  uuid, text, text, text, text, uuid, timestamptz, text, jsonb
) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 4. Triggers
--
-- Each one reads only NEW/OLD and the source row's own columns. No event text
-- is written by hand that the database cannot derive from a record, so no
-- event can claim a company, a role or an amount that is not in the data.
-- ---------------------------------------------------------------------------

-- 4.1 job_opportunities: job_matched, job_saved ----------------------------
--
-- A match is emitted once, on the first score. Re-scoring an already-matched
-- job is not a new match, and a feed that logged every recomputation would
-- bury the matches that matter.
CREATE OR REPLACE FUNCTION odesseus_private.trg_candidate_activity_job_opportunity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
declare
  v_role text := left(coalesce(nullif(btrim(new.role_title), ''), 'a role'), 120);
  v_company text := left(coalesce(nullif(btrim(new.company_name), ''), 'an employer'), 120);
begin
  if new.match_score is not null and (tg_op = 'INSERT' or old.match_score is null) then
    perform odesseus_private.record_candidate_activity(
      new.user_id,
      'job_matched',
      'Matched ' || v_role || ' at ' || v_company,
      'Match score ' || new.match_score,
      'job_opportunity',
      new.id,
      new.discovered_at,
      null,
      jsonb_build_object('match_score', new.match_score, 'source', new.source)
    );
  end if;

  -- status is only ever written by the candidate, so this is a real action and
  -- not something a background job did on their behalf.
  if tg_op = 'UPDATE' and new.status = 'saved' and old.status is distinct from 'saved' then
    perform odesseus_private.record_candidate_activity(
      new.user_id,
      'job_saved',
      'Saved ' || v_role || ' at ' || v_company,
      null,
      'job_opportunity',
      new.id,
      null,
      null,
      jsonb_build_object('match_score', new.match_score, 'source', new.source)
    );
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_candidate_activity_job_opportunity ON public.job_opportunities;
CREATE TRIGGER trg_candidate_activity_job_opportunity
  AFTER INSERT OR UPDATE OF match_score, status ON public.job_opportunities
  FOR EACH ROW EXECUTE FUNCTION odesseus_private.trg_candidate_activity_job_opportunity();

-- 4.2 resumes: resume_uploaded ---------------------------------------------
CREATE OR REPLACE FUNCTION odesseus_private.trg_candidate_activity_resume()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
begin
  perform odesseus_private.record_candidate_activity(
    new.user_id,
    'resume_uploaded',
    'Uploaded ' || left(coalesce(nullif(btrim(new.file_name), ''), 'a resume'), 150),
    case when new.is_master then 'Set as your primary resume' end,
    'resume',
    new.id,
    new.created_at,
    null,
    jsonb_build_object('file_name', new.file_name, 'is_master', new.is_master)
  );
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_candidate_activity_resume ON public.resumes;
CREATE TRIGGER trg_candidate_activity_resume
  AFTER INSERT ON public.resumes
  FOR EACH ROW EXECUTE FUNCTION odesseus_private.trg_candidate_activity_resume();

-- 4.3 resume_tailorings: resume_optimized ----------------------------------
--
-- "Optimized" means the candidate approved the tailored resume, which is the
-- moment a draft becomes usable. Emitting on draft creation would report work
-- the candidate has not accepted.
CREATE OR REPLACE FUNCTION odesseus_private.trg_candidate_activity_resume_tailoring()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
declare
  v_role text;
  v_company text;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    select left(coalesce(nullif(btrim(j.role_title), ''), 'a role'), 120),
           left(coalesce(nullif(btrim(j.company_name), ''), 'an employer'), 120)
      into v_role, v_company
      from public.job_opportunities j
     where j.id = new.job_id;

    perform odesseus_private.record_candidate_activity(
      new.user_id,
      'resume_optimized',
      'Tailored resume ready for ' || coalesce(v_role, 'a role')
        || ' at ' || coalesce(v_company, 'an employer'),
      null,
      'resume_tailoring',
      new.id,
      null,
      null,
      jsonb_build_object(
        'version_number', new.version_number,
        'improvement_count', new.improvement_count
      )
    );
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_candidate_activity_resume_tailoring ON public.resume_tailorings;
CREATE TRIGGER trg_candidate_activity_resume_tailoring
  AFTER UPDATE OF status ON public.resume_tailorings
  FOR EACH ROW EXECUTE FUNCTION odesseus_private.trg_candidate_activity_resume_tailoring();

-- 4.4 application_runs: the apply lifecycle up to submission ---------------
--
-- 'submitted' is deliberately absent. odesseus_finalize_application inserts the
-- application row before it updates the run, so a run-side 'submitted' event
-- would be written after the verification it implies. The applications trigger
-- below owns the pair, and writes both with one timestamp, so the feed order is
-- the real order.
--
-- 'needs_user' splits in two using the existing hold vocabulary. needs_review
-- is itself a hold category, so the split is: a hold the candidate has to clear
-- is application_held, and a hold that only wants their decision is
-- application_needs_input.
CREATE OR REPLACE FUNCTION odesseus_private.trg_candidate_activity_application_run()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
declare
  v_role text;
  v_company text;
  v_hold text;
begin
  if tg_op = 'INSERT' then
    perform odesseus_private.record_candidate_activity(
      new.user_id,
      'application_queued',
      'Started an application for ' || left(coalesce(nullif(btrim(new.target_url), ''), 'a job'), 150),
      case when new.execution_mode = 'smart' then 'Smart Apply' else 'Standard Apply' end,
      'application_run',
      new.id,
      new.created_at,
      null,
      jsonb_build_object('execution_mode', new.execution_mode, 'status', new.status)
    );
    return new;
  end if;

  -- Both columns are watched, and the run is re-evaluated from NEW only, so an
  -- update that sets status and hold_category together still writes one line.
  --
  -- Watching hold_category is not redundant with watching status. The default
  -- sync trigger turns a needs_user run's empty hold_category into
  -- 'needs_review', so a run first asks for a decision and is only later found
  -- to be stuck on a CAPTCHA -- and that second step is an UPDATE that leaves
  -- status alone. Watching status alone would record the first step and stay
  -- silent about the one that actually stopped the application.
  if new.status is not distinct from old.status
     and new.hold_category is not distinct from old.hold_category then
    return new;
  end if;

  select left(coalesce(nullif(btrim(j.role_title), ''), 'a role'), 120),
         left(coalesce(nullif(btrim(j.company_name), ''), 'an employer'), 120)
    into v_role, v_company
    from public.job_opportunities j
   where j.id = new.job_id;

  if new.status = 'ready_to_submit' then
    perform odesseus_private.record_candidate_activity(
      new.user_id,
      'application_needs_review',
      'Ready to send to ' || coalesce(v_company, 'an employer') || '. Review it first.',
      coalesce(v_role, null),
      'application_run',
      new.id,
      null,
      null,
      jsonb_build_object('execution_mode', new.execution_mode)
    );

  elsif new.status = 'needs_user' then
    if new.hold_category is not null and new.hold_category <> 'needs_review' then
      v_hold := new.hold_category;
      perform odesseus_private.record_candidate_activity(
        new.user_id,
        'application_held',
        'Paused at ' || coalesce(v_company, 'an employer') || ': ' || replace(v_hold, '_', ' '),
        nullif(new.stop_reason, ''),
        'application_run',
        new.id,
        null,
        null,
        jsonb_build_object('hold_category', v_hold, 'execution_mode', new.execution_mode)
      );
    else
      perform odesseus_private.record_candidate_activity(
        new.user_id,
        'application_needs_input',
        'Needs your input for ' || coalesce(v_company, 'an employer'),
        nullif(new.stop_reason, ''),
        'application_run',
        new.id,
        null,
        null,
        jsonb_build_object('execution_mode', new.execution_mode)
      );
    end if;

  elsif new.status = 'failed' then
    perform odesseus_private.record_candidate_activity(
      new.user_id,
      'application_failed',
      'Could not apply to ' || coalesce(v_company, 'an employer'),
      nullif(new.stop_reason, ''),
      'application_run',
      new.id,
      null,
      null,
      jsonb_build_object(
        'execution_mode', new.execution_mode,
        'hold_category', new.hold_category
      )
    );
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_candidate_activity_application_run ON public.application_runs;
CREATE TRIGGER trg_candidate_activity_application_run
  AFTER INSERT OR UPDATE OF status, hold_category ON public.application_runs
  FOR EACH ROW EXECUTE FUNCTION odesseus_private.trg_candidate_activity_application_run();

-- 4.5 applications: application_submitted, application_verified -------------
--
-- submitted_at is the discriminator, not status: status moves on to
-- employer_response, interview and offer long after the submission, and an
-- event keyed on a moving status would fire again every time it advanced.
--
-- The pair is emitted together and carries dedupe_key, because this is the one
-- path that is not already unique per event. Re-finalizing a run updates the
-- existing application row and restamps submitted_at, so without the key a
-- retried finalization would add a second "Applied to X" line.
--
-- verified is separate from submitted because they are different facts. A
-- submission with an empty evidence object did happen but nothing about it was
-- captured, and the billing rules already treat those two cases differently.
CREATE OR REPLACE FUNCTION odesseus_private.trg_candidate_activity_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
declare
  v_company text := left(coalesce(nullif(btrim(new.company_name), ''), 'an employer'), 120);
  v_role text := left(coalesce(nullif(btrim(new.role_title), ''), 'a role'), 120);
  v_verified boolean;
begin
  if new.submitted_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.submitted_at is not null then
    return new;
  end if;

  v_verified := coalesce(new.verification_evidence, '{}'::jsonb) <> '{}'::jsonb;

  perform odesseus_private.record_candidate_activity(
    new.user_id,
    'application_submitted',
    'Applied to ' || v_company,
    v_role,
    'application',
    new.id,
    new.submitted_at,
    'application_submitted:' || new.id::text,
    jsonb_build_object(
      'execution_mode', new.execution_mode,
      'verified', v_verified
    )
  );

  if v_verified then
    perform odesseus_private.record_candidate_activity(
      new.user_id,
      'application_verified',
      'Application to ' || v_company || ' verified',
      nullif(new.submission_confirmation, ''),
      'application',
      new.id,
      new.submitted_at,
      'application_verified:' || new.id::text,
      jsonb_build_object('execution_mode', new.execution_mode)
    );
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_candidate_activity_application ON public.applications;
CREATE TRIGGER trg_candidate_activity_application
  AFTER INSERT OR UPDATE OF submitted_at ON public.applications
  FOR EACH ROW EXECUTE FUNCTION odesseus_private.trg_candidate_activity_application();

-- 4.6 interviews: interview_added, mock_interview_completed ----------------
--
-- interview_type has no CHECK constraint, so it cannot be branched on
-- casually. mock_interview_completed fires on exactly one value, 'mock', and on
-- nothing else -- a real interview, however it was detected, can never reach
-- this branch. That is also why the event can exist in the vocabulary before
-- the mock-interview feature does: it is a predicate over a real column, not a
-- placeholder row waiting to be filled in.
--
-- 'email' and 'calendar' are accepted values of interviews.source. They name
-- how the interview was detected, which is a real recorded fact, and reading
-- them is not a mailbox dependency: the dashboard is not scanning anybody inbox,
-- it is reporting a row the candidate or an integration already wrote.
CREATE OR REPLACE FUNCTION odesseus_private.trg_candidate_activity_interview()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
declare
  v_role text;
  v_company text;
  v_when text;
begin
  select left(coalesce(nullif(btrim(a.role_title), ''), 'a role'), 120),
         left(coalesce(nullif(btrim(a.company_name), ''), 'an employer'), 120)
    into v_role, v_company
    from public.applications a
   where a.id = new.application_id;

  v_when := case
    when new.round_number is not null then 'Round ' || new.round_number
    else left(coalesce(nullif(btrim(new.stage), ''), 'interview'), 60)
  end;

  if new.interview_type = 'mock' then
    perform odesseus_private.record_candidate_activity(
      new.user_id,
      'mock_interview_completed',
      'Mock interview completed for ' || coalesce(v_role, 'a role'),
      v_when,
      'interview',
      new.id,
      new.ended_at,
      null,
      jsonb_build_object('round_number', new.round_number)
    );
  else
    perform odesseus_private.record_candidate_activity(
      new.user_id,
      'interview_added',
      v_when || ' with ' || coalesce(v_company, 'an employer') || ' added',
      v_role,
      'interview',
      new.id,
      coalesce(new.scheduled_at, new.created_at),
      null,
      jsonb_build_object(
        'round_number', new.round_number,
        'status', new.status,
        'scheduled_at', new.scheduled_at,
        'source', new.source
      )
    );
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_candidate_activity_interview ON public.interviews;
CREATE TRIGGER trg_candidate_activity_interview
  AFTER INSERT ON public.interviews
  FOR EACH ROW EXECUTE FUNCTION odesseus_private.trg_candidate_activity_interview();

-- 4.7 credit_transactions: wallet_charged, wallet_topped_up -----------------
--
-- This is the reason the whole design is trigger-based. Roughly twenty RPCs
-- insert into credit_transactions; only four of them are candidate wallet
-- movements worth a feed line.
--
-- Two credit types are deliberately excluded:
--   admin_adjustment is an operator correcting a balance. It belongs in
--     admin_audit_log, where the actor is recorded, and putting it in a
--     candidate feed would show them a movement they did not make and cannot
--     explain.
--   interview is a Live pass, not a wallet balance, and the dashboard reports
--     passes separately.
--
-- Sign is taken from delta, not from credit_type, because a refund is a
-- positive standard_apply and reporting it as a charge would be a lie.
CREATE OR REPLACE FUNCTION odesseus_private.trg_candidate_activity_credit_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
declare
  v_meta jsonb := jsonb_build_object(
    'credit_type', new.credit_type,
    'delta', new.delta,
    'amount_cents', new.amount_cents
  );
begin
  if new.credit_type = 'wallet_topup' then
    perform odesseus_private.record_candidate_activity(
      new.user_id,
      'wallet_topped_up',
      'Wallet topped up',
      nullif(new.reason, ''),
      'credit_transaction',
      new.id,
      new.created_at,
      null,
      v_meta
    );

  elsif new.credit_type in ('standard_apply', 'smart_apply', 'application')
        and new.delta < 0 then
    perform odesseus_private.record_candidate_activity(
      new.user_id,
      'wallet_charged',
      case new.credit_type
        when 'smart_apply' then 'Charged for a smart application'
        when 'standard_apply' then 'Charged for a standard application'
        else 'Charged for an application'
      end,
      nullif(new.reason, ''),
      'credit_transaction',
      new.id,
      new.created_at,
      null,
      v_meta
    );
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_candidate_activity_credit_transaction ON public.credit_transactions;
CREATE TRIGGER trg_candidate_activity_credit_transaction
  AFTER INSERT ON public.credit_transactions
  FOR EACH ROW EXECUTE FUNCTION odesseus_private.trg_candidate_activity_credit_transaction();

-- 4.8 application_agent_settings: agent_paused, agent_resumed ---------------
--
-- The pause state is application_agent_settings.paused, not a decision row, so
-- the transition on the settings row is the event. Re-saving the settings form
-- with the same value fires the trigger but writes nothing, because the branch
-- is a comparison against OLD.
CREATE OR REPLACE FUNCTION odesseus_private.trg_candidate_activity_agent_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
begin
  if new.paused = old.paused then
    return new;
  end if;

  if new.paused then
    perform odesseus_private.record_candidate_activity(
      new.user_id, 'agent_paused', 'Application Agent paused',
      null,
      'application_agent_settings', new.user_id, null, null,
      jsonb_build_object('mode', new.mode)
    );
  else
    perform odesseus_private.record_candidate_activity(
      new.user_id, 'agent_resumed', 'Application Agent resumed',
      null, 'application_agent_settings', new.user_id, null, null,
      jsonb_build_object('mode', new.mode)
    );
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_candidate_activity_agent_settings ON public.application_agent_settings;
CREATE TRIGGER trg_candidate_activity_agent_settings
  AFTER UPDATE OF paused ON public.application_agent_settings
  FOR EACH ROW EXECUTE FUNCTION odesseus_private.trg_candidate_activity_agent_settings();

-- ---------------------------------------------------------------------------
-- 5. Privileges on the trigger functions
--
-- They live in odesseus_private, which no browser role can reach, and are
-- revoked from PUBLIC so that being granted the schema is never enough.
-- ---------------------------------------------------------------------------

DO $block$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'odesseus_private'
      AND p.proname LIKE 'trg_candidate_activity_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO postgres, service_role', r.sig);
  END LOOP;
END
$block$;

COMMIT;
