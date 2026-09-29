-- Guest Live Access (Phase 2O) pgTAP checks.
--
-- The no-account guest model stores one row per shared link. RLS must be on
-- with owner-only policies, anonymous clients must hold no privileges, the
-- raw token must never be a column, and the interview source domain must
-- admit the guest-share value alongside the historical ones.

begin;
select plan(11);

select has_table('public', 'guest_access_records', 'guest_access_records exists');

select col_is_pk('public', 'guest_access_records', 'id', 'guest_access_records id is the primary key');

select col_not_null('public', 'guest_access_records', 'owner_user_id', 'owner_user_id is required');
select col_not_null('public', 'guest_access_records', 'token_sha256', 'token hash is required');

select ok(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.guest_access_records'::regclass
      and contype = 'u') >= 1,
  'token hash is unique'
);

select results_eq(
  $$ select relrowsecurity from pg_class
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace
     where nspname = 'public' and relname = 'guest_access_records' $$,
  $$ values (true) $$,
  'guest_access_records has RLS enabled'
);

select results_eq(
  $$ select count(*)::int from pg_policies
     where schemaname = 'public' and tablename = 'guest_access_records' $$,
  $$ values (4) $$,
  'guest_access_records has exactly the four owner policies'
);

select is_empty(
  $$ select * from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'guest_access_records'
       and grantee = 'anon' $$,
  'anon holds no privileges on guest_access_records'
);

select ok(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public'
      and table_name = 'guest_access_records'
      and (column_name like '%token%' and column_name <> 'token_sha256')) = 0,
  'no raw-token column exists; only the hash is stored'
);

select results_eq(
  $$ select count(*)::int from pg_constraint
     where conrelid = 'public.interviews'::regclass
       and conname = 'interviews_source_check'
       and pg_get_constraintdef(oid) like '%guest_share_link%' $$,
  $$ values (1) $$,
  'interviews source domain admits guest_share_link'
);

select results_eq(
  $$ select count(*)::int from pg_constraint
     where conrelid = 'public.live_guest_invites'::regclass
       and contype = 'f'
       and pg_get_constraintdef(oid) like '%live_interview_sessions%' $$,
  $$ values (1) $$,
  'historical guest invites link to live sessions without schema churn'
);

select * from finish();
rollback;
