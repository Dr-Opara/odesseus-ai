-- Employer hiring backend: applicants, Fit Score, pipeline (Phase 2R).
--
-- Everything here is additive. No existing table, constraint, policy, or
-- function is altered. The applicant edge reuses the existing attribution
-- (applications.job_id -> job_opportunities.employer_job_id ->
-- employer_jobs.org_id); this migration only adds the org-scoped read
-- accessor plus the two new hiring tables.
--
-- Privacy boundary (load-bearing): the accessor returns application payloads
-- tied to the org's own jobs (resume/job snapshots, match, status) and
-- nothing else. Candidate-private Live transcripts, Live guidance, mock
-- interview feedback, Interview Prep, and post-interview analysis live in
-- other tables and are never selected here. No user_id is returned, so
-- employer reads cannot pivot into candidate-private data.

-- ---------------------------------------------------------------------------
-- 1. Structured hiring fields on employer_jobs (all nullable, additive).
--    The Fit Score derives required/preferred qualifications from these plus
--    the description; nothing existing changes.
-- ---------------------------------------------------------------------------

alter table public.employer_jobs
  add column if not exists requirements_text text;

alter table public.employer_jobs
  add column if not exists preferred_text text;

alter table public.employer_jobs
  add column if not exists work_arrangement text
    check (work_arrangement is null or work_arrangement in ('remote', 'hybrid', 'onsite'));

comment on column public.employer_jobs.requirements_text is
  'Required qualifications for Fit Score evidence matching; free text';
comment on column public.employer_jobs.preferred_text is
  'Preferred qualifications for Fit Score evidence matching; free text';
comment on column public.employer_jobs.work_arrangement is
  'remote, hybrid, or onsite; used for location alignment, never inferred';

-- ---------------------------------------------------------------------------
-- 2. Org-scoped applicant accessor (service-role callable, membership-gated
--    internally). Returns one row per application to the org's jobs.
-- ---------------------------------------------------------------------------

create or replace function public.odesseus_get_employer_applicants (
  p_org_id uuid,
  p_job_id uuid default null
)
  returns table (
    application_id uuid,
    employer_job_id uuid,
    job_title text,
    job_status text,
    application_status text,
    submitted_at timestamptz,
    company_name text,
    role_title text,
    resume_snapshot jsonb,
    job_snapshot jsonb,
    match_score_snapshot smallint,
    verification_evidence jsonb
  )
  language plpgsql
  stable
  security definer
  set search_path to 'public', 'odesseus_private', 'pg_temp'
as $function$
declare
  v_caller uuid := auth.uid();
  v_is_member boolean;
  v_is_owner boolean;
begin
  if p_org_id is null then
    raise exception 'An organization id is required' using errcode = '22023';
  end if;

  -- The caller must belong to the org (member row) or own it. service_role
  -- has no auth.uid() and is the server itself.
  if v_caller is not null then
    select exists (
      select 1 from public.employer_members
      where org_id = p_org_id and user_id = v_caller
    ) into v_is_member;

    select exists (
      select 1 from public.employer_organizations
      where id = p_org_id and owner_user_id = v_caller
    ) into v_is_owner;

    if not v_is_member and not v_is_owner then
      raise exception 'Not permitted' using errcode = '42501';
    end if;
  end if;

  return query
  select
    a.id,
    ej.id,
    ej.title,
    ej.status,
    a.status,
    a.submitted_at,
    a.company_name,
    a.role_title,
    a.resume_snapshot,
    a.job_snapshot,
    a.match_score_snapshot,
    a.verification_evidence
  from public.applications a
  join public.job_opportunities jo on jo.id = a.job_id
  join public.employer_jobs ej on ej.id = jo.employer_job_id
  where ej.org_id = p_org_id
    and (p_job_id is null or ej.id = p_job_id)
  order by a.submitted_at desc nulls last, a.created_at desc;
end;
$function$;

comment on function public.odesseus_get_employer_applicants(uuid, uuid) is
  'Org-scoped applicant read for employer hiring. Membership-gated internally; returns application payloads for the org''s own jobs only, never candidate-private Live/mock/prep content and never user ids.';

revoke all on function public.odesseus_get_employer_applicants(uuid, uuid) from public;
revoke all on function public.odesseus_get_employer_applicants(uuid, uuid) from anon;
grant execute on function public.odesseus_get_employer_applicants(uuid, uuid) to authenticated, postgres, service_role;

-- ---------------------------------------------------------------------------
-- 3. Employer Fit Scores (cached, evidence-backed, recomputable).
--    One row per (job, application); recomputation upserts the row and bumps
--    the version. Reads are org-member (+owner) scoped; writes are
--    service-role only and happen exclusively through the Fit Score service,
--    which grounds every claim in the submitted resume and the job posting.
-- ---------------------------------------------------------------------------

create table if not exists public.employer_fit_scores (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.employer_organizations(id) on delete cascade,
  job_id uuid not null references public.employer_jobs(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  score integer not null check (score >= 0 and score <= 100),
  required_matches jsonb not null default '[]'::jsonb,
  preferred_matches jsonb not null default '[]'::jsonb,
  missing_qualifications jsonb not null default '[]'::jsonb,
  missing_skills jsonb not null default '[]'::jsonb,
  location_alignment jsonb not null default '{}'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  explanation text not null default '',
  model_version text not null default 'v1',
  version_number integer not null default 1 check (version_number >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employer_fit_scores_unique_job_application
    unique (job_id, application_id)
);

comment on table public.employer_fit_scores is
  'Cached evidence-backed Fit Scores per job application. Every dimension must cite resume evidence; protected characteristics are never inputs. Recomputed on demand; version_number bumps per recompute.';

create index if not exists employer_fit_scores_org_job_idx
  on public.employer_fit_scores (org_id, job_id);
create index if not exists employer_fit_scores_org_score_idx
  on public.employer_fit_scores (org_id, score desc);

alter table public.employer_fit_scores enable row level security;

create policy "employer_fit_scores_select_member"
  on public.employer_fit_scores for select to authenticated
  using (
    odesseus_private.is_org_member(org_id)
    or exists (
      select 1 from public.employer_organizations o
      where o.id = org_id and o.owner_user_id = auth.uid()
    )
  );

revoke all on table public.employer_fit_scores from anon, authenticated;
grant select on table public.employer_fit_scores to authenticated;
grant all privileges on table public.employer_fit_scores to postgres, service_role;

-- ---------------------------------------------------------------------------
-- 4. Hiring pipeline stages (insert-only history, locked stage vocabulary).
--    The current stage of an application is its latest row. History is never
--    updated or deleted: a transition appends. Role gating (owner/admin/
--    recruiter write, viewer read-only) is enforced at the API layer on top
--    of these row policies via getOrgRole; the policies below keep reads
--    member-scoped and writes service-role-only so no client can forge or
--    rewrite history directly.
-- ---------------------------------------------------------------------------

create table if not exists public.employer_pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.employer_organizations(id) on delete cascade,
  job_id uuid not null references public.employer_jobs(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  stage text not null check (
    stage in ('applied', 'reviewing', 'shortlisted', 'interview', 'offer', 'hired', 'rejected')
  ),
  changed_by uuid references auth.users(id) on delete set null,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.employer_pipeline_stages is
  'Append-only hiring pipeline history. Latest row per application is the current stage. Stages: applied, reviewing, shortlisted, interview, offer, hired, rejected.';

create index if not exists employer_pipeline_org_job_app_idx
  on public.employer_pipeline_stages (org_id, job_id, application_id, created_at desc);

alter table public.employer_pipeline_stages enable row level security;

create policy "employer_pipeline_select_member"
  on public.employer_pipeline_stages for select to authenticated
  using (
    odesseus_private.is_org_member(org_id)
    or exists (
      select 1 from public.employer_organizations o
      where o.id = org_id and o.owner_user_id = auth.uid()
    )
  );

revoke all on table public.employer_pipeline_stages from anon, authenticated;
grant select on table public.employer_pipeline_stages to authenticated;
grant all privileges on table public.employer_pipeline_stages to postgres, service_role;

-- ---------------------------------------------------------------------------
-- 5. Hiring-manager role helper (owner/admin/recruiter may mutate pipeline;
--    viewers read only).
-- ---------------------------------------------------------------------------

create or replace function odesseus_private.is_org_hiring_manager(p_org_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public', 'odesseus_private', 'pg_temp'
as $function$
  select exists (
    select 1 from public.employer_organizations o
    where o.id = p_org_id and o.owner_user_id = auth.uid()
  ) or exists (
    select 1 from public.employer_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and m.role in ('admin', 'recruiter')
  );
$function$;

comment on function odesseus_private.is_org_hiring_manager(uuid) is
  'True when the caller may mutate hiring state: the org owner, an admin, or a recruiter. Viewers read only.';

revoke all on function odesseus_private.is_org_hiring_manager(uuid) from public;
grant execute on function odesseus_private.is_org_hiring_manager(uuid) to authenticated, postgres, service_role;

-- ---------------------------------------------------------------------------
-- 6. Stats
-- ---------------------------------------------------------------------------
analyze public.employer_fit_scores;
analyze public.employer_pipeline_stages;

-- End of 20261117000000_employer_hiring.sql
