-- Candidate dashboard counts (Phase 2J, second half).
--
-- The dashboard's numbers are wrong today, and they are wrong in a way that is
-- not visible on the screen. `src/app/dashboard/page.tsx` fetches five job rows
-- and twenty application rows, then counts them:
--
--   strongMatches = jobs.filter(j => j.match_score >= threshold).length
--
-- A candidate with four hundred discovered jobs and thirty strong matches sees
-- at most five jobs fetched and a strong-match count of zero to five, reported
-- with no indication that it is a count of a sample. The same applies to the
-- pipeline row and to the interview count. These are not measurements of the
-- candidate's search; they are measurements of how much the page fetched.
--
-- The fix is to count in the database. One function, one round trip, one
-- transaction-consistent snapshot, and a number that means what the label says.
--
-- Ownership is enforced here rather than trusted from the caller. The function
-- is SECURITY DEFINER so it can read across the run/application/interview
-- tables in one pass, which means the browser role is not restricted to its own
-- rows by RLS while it runs -- so the function has to make that check itself.
-- An authenticated caller may only ask about itself; service_role, whose
-- auth.uid() is null, may ask about anyone.
--
-- Nothing here is derived from external_signals, application_status_events, or
-- any other provider-integration table. A candidate with no mailbox connected
-- sees exactly the same dashboard as one with a connected mailbox, which is the
-- whole point of a native Odesseus dashboard.

BEGIN;

CREATE OR REPLACE FUNCTION public.odesseus_get_candidate_dashboard_counts (
  p_user_id uuid,
  -- integer rather than smallint: an unadorned literal like 85 is an integer,
  -- and a smallint parameter makes every plain SQL caller reach for a cast.
  -- The value is clamped to 0..100 below either way.
  p_strong_match_threshold integer DEFAULT 85
) RETURNS TABLE (
  jobs_discovered bigint,
  jobs_strong_matches bigint,
  jobs_saved bigint,
  jobs_reviewing bigint,
  applications_total bigint,
  applications_submitted bigint,
  applications_verified bigint,
  queue_total bigint,
  queue_in_flight bigint,
  queue_needs_review bigint,
  queue_needs_input bigint,
  queue_held bigint,
  queue_failed bigint,
  interviews_total bigint,
  interviews_upcoming bigint,
  interviews_completed bigint,
  prep_generated bigint,
  prep_last_generated_at timestamptz,
  resumes_total bigint,
  resumes_approved bigint,
  has_primary_resume boolean,
  agent_decisions_today bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_threshold integer;
begin
  if p_user_id is null then
    raise exception 'A user id is required' USING ERRCODE = '22023';
  end if;

  -- A browser session may only read its own counts. service_role has no
  -- auth.uid(), which is the only way this branch is skipped, and that role is
  -- already the server.
  if v_caller is not null and v_caller <> p_user_id then
    raise exception 'Not permitted' USING ERRCODE = '42501';
  end if;

  -- The threshold is the candidate's own job_preferences.minimum_match_score,
  -- passed in by the caller. It is clamped rather than trusted: a negative or
  -- absurd value would make "strong matches" mean nothing, and this number is
  -- one the candidate will act on.
  v_threshold := greatest(0, least(100, coalesce(p_strong_match_threshold, 85)));

  return query
  with jobs as (
    select
      count(*) as discovered,
      count(*) filter (
        where match_score is not null and match_score >= v_threshold
      ) as strong,
      count(*) filter (where status = 'saved') as saved,
      count(*) filter (where status = 'reviewing') as reviewing
    from public.job_opportunities
    where user_id = p_user_id
      -- A closed or rejected posting is not part of the search any more.
      -- Counting them would make "jobs discovered" grow forever as roles
      -- expire underneath the candidate.
      and status not in ('closed', 'rejected')
  ),
  apps as (
    select
      count(*) as total,
      count(*) filter (where submitted_at is not null) as submitted,
      count(*) filter (
        where submitted_at is not null
          and coalesce(verification_evidence, '{}'::jsonb) <> '{}'::jsonb
      ) as verified
    from public.applications
    where user_id = p_user_id
  ),
  runs as (
    select
      count(*) filter (
        where status not in ('submitted', 'failed', 'cancelled')
      ) as queue_total,
      count(*) filter (
        where status in ('queued', 'preflight', 'running', 'submitting')
      ) as in_flight,
      count(*) filter (where status = 'ready_to_submit') as needs_review,
      count(*) filter (
        where status = 'needs_user'
          and (hold_category is null or hold_category = 'needs_review')
      ) as needs_input,
      count(*) filter (
        where status = 'needs_user'
          and hold_category is not null
          and hold_category <> 'needs_review'
      ) as held,
      count(*) filter (where status = 'failed') as failed
    from public.application_runs
    where user_id = p_user_id
  ),
  ints as (
    select
      count(*) as total,
      count(*) filter (
        where status in ('invited', 'scheduled', 'ready')
          and (scheduled_at is null or scheduled_at >= now())
      ) as upcoming,
      count(*) filter (where status = 'completed') as completed
    from public.interviews
    where user_id = p_user_id
  ),
  prep as (
    select count(*) as generated, max(created_at) as last_generated
    from public.interview_readiness
    where user_id = p_user_id
  ),
  docs as (
    select
      count(*) as total,
      count(*) filter (where is_approved) as approved,
      coalesce(bool_or(is_master), false) as has_primary
    from public.resumes
    where user_id = p_user_id
  ),
  agent as (
    -- The agent's own daily ceiling is enforced against the same day boundary
    -- in the decision engine, so the counter shown beside it has to use the
    -- same one or the two will disagree at midnight.
    select count(*) as today
    from public.application_agent_decisions
    where user_id = p_user_id
      and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
  )
  select
    jobs.discovered,
    jobs.strong,
    jobs.saved,
    jobs.reviewing,
    apps.total,
    apps.submitted,
    apps.verified,
    runs.queue_total,
    runs.in_flight,
    runs.needs_review,
    runs.needs_input,
    runs.held,
    runs.failed,
    ints.total,
    ints.upcoming,
    ints.completed,
    prep.generated,
    prep.last_generated,
    docs.total,
    docs.approved,
    docs.has_primary,
    agent.today
  from jobs, apps, runs, ints, prep, docs, agent;
end;
$function$;

COMMENT ON FUNCTION public.odesseus_get_candidate_dashboard_counts(uuid, integer) IS
  'Exact, server-side dashboard counts for one candidate. Replaces counts taken '
  'from a 5-row job fetch and a 20-row application fetch, which were counts of a '
  'sample rather than counts of the search. Reads no provider-integration table, '
  'so a candidate with no mailbox connected sees the same dashboard as one who '
  'has one. An authenticated caller may only pass its own user id. The queue '
  'columns partition: in_flight + needs_review + needs_input + held = queue_total. '
  'Note that application_runs_one_active_per_user permits at most one run per '
  'candidate in an active status, so queue_total is 0 or 1 in practice and the '
  'dashboard should present the current application rather than a backlog.';

REVOKE ALL ON FUNCTION public.odesseus_get_candidate_dashboard_counts(uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.odesseus_get_candidate_dashboard_counts(uuid, integer)
  TO authenticated, postgres, service_role;

COMMIT;
