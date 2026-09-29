-- Employer hiring backend (Phase 2R) pgTAP checks.
--
-- Fit scores and pipeline history are org-scoped with member reads and no
-- direct authenticated writes (writes are service-side after role checks).
-- Anonymous clients hold nothing. The pipeline vocabulary is locked to the
-- seven approved stages.

begin;
select plan(13);

select has_table('public', 'employer_fit_scores', 'employer_fit_scores exists');
select has_table('public', 'employer_pipeline_stages', 'employer_pipeline_stages exists');

select results_eq(
  $$ select relrowsecurity from pg_class
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace
     where nspname = 'public' and relname in ('employer_fit_scores', 'employer_pipeline_stages')
     order by relname $$,
  $$ values (true), (true) $$,
  'both hiring tables have RLS enabled'
);

select results_eq(
  $$ select count(*)::int from pg_policies
     where schemaname = 'public' and tablename = 'employer_fit_scores' $$,
  $$ values (1) $$,
  'fit scores carry exactly the member-read policy'
);

select results_eq(
  $$ select count(*)::int from pg_policies
     where schemaname = 'public' and tablename = 'employer_pipeline_stages' $$,
  $$ values (1) $$,
  'pipeline history carries exactly the member-read policy'
);

select is_empty(
  $$ select * from pg_policies
     where schemaname = 'public'
       and tablename in ('employer_fit_scores', 'employer_pipeline_stages')
       and cmd in ('INSERT', 'UPDATE', 'DELETE')
       and roles::text like '%authenticated%' $$,
  'authenticated has no direct write policies on hiring tables'
);

select is_empty(
  $$ select * from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name in ('employer_fit_scores', 'employer_pipeline_stages')
       and grantee = 'anon' $$,
  'anon holds no privileges on hiring tables'
);

select results_eq(
  $$ select pg_get_constraintdef(oid) from pg_constraint
     where conrelid = 'public.employer_pipeline_stages'::regclass
       and conname = 'employer_pipeline_stages_stage_check' $$,
  $$ values (
    'CHECK ((stage = ANY (ARRAY[''applied''::text, ''reviewing''::text, ''shortlisted''::text, ''interview''::text, ''offer''::text, ''hired''::text, ''rejected''::text])))'
  ) $$,
  'pipeline stage vocabulary is exactly the seven locked stages'
);

select has_function('public', 'odesseus_get_employer_applicants', 'applicant accessor exists');

select results_eq(
  $$ select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'odesseus_get_employer_applicants'
       and pg_get_function_identity_arguments(p.oid) = 'p_org_id uuid, p_job_id uuid' $$,
  $$ values (1) $$,
  'applicant accessor takes org id plus optional job id'
);

select has_function('odesseus_private', 'is_org_hiring_manager', 'hiring-manager helper exists');

select results_eq(
  $$ select count(*)::int from information_schema.columns
     where table_schema = 'public'
       and table_name = 'employer_jobs'
       and column_name in ('requirements_text', 'preferred_text', 'work_arrangement') $$,
  $$ values (3) $$,
  'job postings carry the three hiring-evidence columns'
);

select results_eq(
  $$ select pg_get_constraintdef(oid) from pg_constraint
     where conrelid = 'public.employer_jobs'::regclass
       and conname = 'employer_jobs_work_arrangement_check' $$,
  $$ values (
    'CHECK (((work_arrangement IS NULL) OR (work_arrangement = ANY (ARRAY[''remote''::text, ''hybrid''::text, ''onsite''::text]))))'
  ) $$,
  'work arrangement is constrained to the three stated values'
);

select * from finish();
rollback;
