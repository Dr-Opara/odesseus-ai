-- Employer provisioning RPC (Phase 2P) pgTAP checks.
--
-- odesseus_ensure_employer_organization must converge retries and concurrent
-- calls onto exactly one org plus one owner membership, heal half-provisioned
-- accounts, prefer an already-joined org over minting a duplicate, and reject
-- blank company names. Auth users are fabricated directly since tests run as
-- superuser-adjacent local roles with a fresh database per reset.

begin;
select plan(10);

-- Fabricate two auth users without touching the app layer.
insert into auth.users (id, email, encrypted_password, email_confirmed_at)
values
  ('11111111-1111-4111-8111-111111111111', 'owner-a@example.test', 'x', now()),
  ('22222222-2222-4222-8222-222222222222', 'owner-b@example.test', 'x', now())
on conflict (id) do nothing;

-- 1. First call provisions exactly one org plus one owner membership.
select lives_ok(
  $$ select public.odesseus_ensure_employer_organization(
    '11111111-1111-4111-8111-111111111111', 'Acme Corp') $$,
  'first provisioning call succeeds'
);

select results_eq(
  $$ select count(*)::int from public.employer_organizations
     where owner_user_id = '11111111-1111-4111-8111-111111111111' $$,
  $$ values (1) $$,
  'exactly one org for a fresh user'
);

select results_eq(
  $$ select role from public.employer_members
     where user_id = '11111111-1111-4111-8111-111111111111' $$,
  $$ values ('owner'::text) $$,
  'exactly one owner membership for a fresh user'
);

-- 2. Retry converges: a second call returns the same org, no duplicates.
select results_eq(
  $$ select (public.odesseus_ensure_employer_organization(
      '11111111-1111-4111-8111-111111111111', 'Acme Corp')).id =
    (select id from public.employer_organizations
      where owner_user_id = '11111111-1111-4111-8111-111111111111') $$,
  $$ values (true) $$,
  'retry returns the same org'
);

select results_eq(
  $$ select count(*)::int from public.employer_organizations
     where owner_user_id = '11111111-1111-4111-8111-111111111111' $$,
  $$ values (1) $$,
  'retry creates no second org'
);

select results_eq(
  $$ select count(*)::int from public.employer_members
     where user_id = '11111111-1111-4111-8111-111111111111' $$,
  $$ values (1) $$,
  'retry creates no second membership'
);

-- 3. Heals a half-provisioned account: org row without a member row.
insert into public.employer_organizations (id, name, owner_user_id)
values ('33333333-3333-4333-8333-333333333333', 'Half Corp', '22222222-2222-4222-8222-222222222222')
on conflict (id) do nothing;

select results_eq(
  $$ select (public.odesseus_ensure_employer_organization(
      '22222222-2222-4222-8222-222222222222', 'Half Corp')).id $$,
  $$ values ('33333333-3333-4333-8333-333333333333'::uuid) $$,
  'half-provisioned owner resolves to the existing org'
);

select results_eq(
  $$ select count(*)::int from public.employer_members
     where user_id = '22222222-2222-4222-8222-222222222222' $$,
  $$ values (1) $$,
  'half-provisioned owner gains the missing member row'
);

-- 4. Blank company names are rejected, never stored.
select throws_ok(
  $$ select public.odesseus_ensure_employer_organization(
    '22222222-2222-4222-8222-222222222222', '   ') $$,
  '22023',
  'A company name is required'
);

-- 5. A different user still gets their own org (no cross-user collapse).
select results_eq(
  $$ select count(*)::int from public.employer_organizations $$,
  $$ values (2) $$,
  'two users hold two orgs total'
);

select * from finish();
rollback;
