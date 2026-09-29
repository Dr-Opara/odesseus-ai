-- Public homepage job feed store (Phase: homepage job feed) pgTAP checks.
--
-- public_job_posts is infrastructure, not a user table: no client role may
-- read it directly. The feed API serves an allowlisted projection through
-- the service role. Dedupe identity is (source_key, external_id).

begin;
select plan(9);

select has_table('public', 'public_job_posts', 'public_job_posts exists');

select results_eq(
  $$ select count(*)::int from pg_constraint
     where conrelid = 'public.public_job_posts'::regclass
       and contype = 'u' $$,
  $$ values (1) $$,
  'exactly one unique constraint (source identity)'
);

select results_eq(
  $$ select relrowsecurity from pg_class
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace
     where nspname = 'public' and relname = 'public_job_posts' $$,
  $$ values (true) $$,
  'public_job_posts has RLS enabled'
);

select is_empty(
  $$ select * from pg_policies
     where schemaname = 'public' and tablename = 'public_job_posts' $$,
  'no policies: deny-by-default for every client role'
);

select is_empty(
  $$ select * from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'public_job_posts'
       and grantee in ('anon', 'authenticated') $$,
  'anon and authenticated hold no direct privileges'
);

select results_eq(
  $$ select count(*)::int from information_schema.columns
     where table_schema = 'public'
       and table_name = 'public_job_posts'
       and column_name in (
         'salary_text', 'apply_url', 'source_url', 'published_at',
         'first_seen_at', 'last_seen_at', 'is_active'
       ) $$,
  $$ values (7) $$,
  'nullable provenance columns exist so missing values stay absent'
);

select ok(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public'
      and table_name = 'public_job_posts'
      and column_name in ('user_id', 'match_score')) = 0,
  'no per-user or score columns: nothing personal can leak through the store'
);

select results_eq(
  $$ select indexname from pg_indexes
     where schemaname = 'public' and tablename = 'public_job_posts'
       and indexname = 'public_job_posts_active_seen_idx' $$,
  $$ values ('public_job_posts_active_seen_idx'::name) $$,
  'active-recency index exists for the feed read'
);

select results_eq(
  $$ select count(*)::int from pg_indexes
     where schemaname = 'public' and tablename = 'public_job_posts' $$,
  $$ values (5) $$,
  'primary key, unique-identity backing, plus the three feed indexes'
);

select * from finish();
rollback;
