-- Guest Live Access (Phase 2O). Additive migration only.
--
-- Simplified no-account model: an authenticated Share Annual applicant
-- generates a secure link and shares it manually. The guest never creates an
-- Odesseus account, never signs in, and has no wallet or billing. The guest
-- opens the link, enters their own interview context, and uses the SAME
-- existing Live session/guidance/transcript/post-interview infrastructure.
--
-- There is deliberately NO slot/cap accounting, NO scheduled activation
-- window, NO expiry-after-interview, and NO revoke workflow in this phase.
-- Guest access is server-mediated (service role); anonymous clients receive
-- no direct database privileges.

-- ---------------------------------------------------------------------------
-- 1. Extend live_guest_invites to support no-account guest access.
--    The table already exists from Phase 1 historical work; it is left
--    otherwise untouched for compatibility. Only a nullable session link is
--    added (many guests may never activate, and that's fine).
-- ---------------------------------------------------------------------------

alter table public.live_guest_invites
  add column if not exists session_id uuid
    references public.live_interview_sessions(id) on delete set null;

comment on column public.live_guest_invites.session_id is
  'Nullable FK to live_interview_sessions; set when guest activates a session';

-- ---------------------------------------------------------------------------
-- 2. Standalone guest access records for the no-account model.
--    This is NOT an account: no auth.users row, no profile, no wallet.
--    Each row is one shared link, owned by the Share Annual holder who
--    created it. Only the token SHA-256 hex digest is stored; the raw token
--    is returned once at creation and never persisted or logged.
-- ---------------------------------------------------------------------------
create table if not exists public.guest_access_records (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  token_sha256 text not null unique,
  -- Guest-provided setup, stored separately from any applicant profile.
  guest_name text,
  guest_company text,
  guest_role_title text,
  guest_job_description text,
  guest_resume_text text,
  guest_resume_storage_path text,
  guest_resume_profile jsonb,
  guest_interview_type text,
  guest_round text,
  guest_notes text,
  -- Links set once the guest starts a session (reuses existing Live rows).
  interview_id uuid references public.interviews(id) on delete set null,
  live_session_id uuid references public.live_interview_sessions(id) on delete set null,
  -- Lifecycle: pending (link created) -> active (session started) ->
  -- completed. Cancelled is a terminal state reserved for abuse handling.
  status text not null default 'pending'
    check (status in ('pending','active','completed','cancelled')),
  activated_at timestamp with time zone,
  completed_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

comment on table public.guest_access_records is
  'One row per shared no-account Guest Live link. Guest interview context lives here and in the linked Live rows; never in the applicant profile, Resume Hub, or application history. Raw tokens are never stored.';

create index if not exists guest_access_owner_idx
  on public.guest_access_records (owner_user_id);

-- ---------------------------------------------------------------------------
-- 3. Row-level security: owner rows only, no anonymous access.
--    Guest traffic is server-mediated (service role); anon receives nothing.
-- ---------------------------------------------------------------------------
alter table public.guest_access_records enable row level security;

create policy "Owner can view own guest access records"
  on public.guest_access_records for select
  using (auth.uid() = owner_user_id);

create policy "Owner can insert own guest access records"
  on public.guest_access_records for insert
  with check (auth.uid() = owner_user_id);

create policy "Owner can update own guest access records"
  on public.guest_access_records for update
  using (auth.uid() = owner_user_id);

create policy "Owner can delete own guest access records"
  on public.guest_access_records for delete
  using (auth.uid() = owner_user_id);

revoke all on table public.guest_access_records from anon, authenticated;
grant select, insert, update, delete on table public.guest_access_records to authenticated;
grant all privileges on table public.guest_access_records to postgres, service_role;

-- ---------------------------------------------------------------------------
-- 4. Allow the guest-share interview source.
--    Guest sessions reuse the interviews table with source =
--    'guest_share_link' so the entire Live lifecycle works unchanged.
--    Strict superset of the baseline CHECK: every previously valid value
--    remains valid and no row is touched.
-- ---------------------------------------------------------------------------
alter table public.interviews
  drop constraint if exists interviews_source_check;

alter table public.interviews
  add constraint interviews_source_check
  check (
    source is null or source = any (array['email'::text, 'calendar'::text, 'manual'::text, 'guest_share_link'::text])
  );

-- ---------------------------------------------------------------------------
-- 5. Keep guest-share interviews out of the owner's dashboard counts.
--    Verbatim copy of 20261028000000_candidate_dashboard_counts with exactly
--    one delta: the ints CTE excludes source = 'guest_share_link', because a
--    guest session is private to its guest and must never surface in the
--    owner's dashboard. All other CTEs, grants, and comments are unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.odesseus_get_candidate_dashboard_counts (
  p_user_id uuid,
  p_strong_match_threshold integer default 85
) returns table (
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
language plpgsql
stable
security definer
set search_path to 'public', 'odesseus_private', 'pg_temp'
as $function$
declare
  v_caller uuid := auth.uid();
  v_threshold integer;
begin
  if p_user_id is null then
    raise exception 'A user id is required' using errcode = '22023';
  end if;

  if v_caller is not null and v_caller <> p_user_id then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

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
      -- Phase 2O: guest-share interviews belong to their guest session, not
      -- to the owner's dashboard.
      and (source is null or source <> 'guest_share_link')
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

-- ---------------------------------------------------------------------------
-- 6. Index and stats
-- ---------------------------------------------------------------------------
analyze public.guest_access_records;

-- End of 20261115000000_guest_live_access.sql
