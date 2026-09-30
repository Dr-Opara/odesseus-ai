-- Final RC authorization, privacy, and cross-actor data isolation (pgTAP).
-- Run with: npx supabase test db
--
-- ===========================================================================
-- WHY THIS SUITE EXISTS
-- ===========================================================================
--
-- Every other suite proves one accessor behaves. This one proves the *shape of
-- the boundary* between actor types, as the real database roles, against the
-- real schema -- which is the only way to catch a leak that is invisible to a
-- unit test because the unit test supplied the scoping itself.
--
-- The actors, and the claim each section makes:
--
--   1. A candidate sees only their own rows.
--   2. A candidate cannot reach any employer surface.
--   3. An employer sees only their own organization.
--   4. An employer cannot reach any candidate-private surface.
--   5. No employer role can mutate employer tables directly -- so route
--      authorization is the *only* gate, which is why it is asserted here
--      rather than assumed.
--   6. A candidate cannot grant themselves money or passes.
--   7. Anonymous holds no broad access, and no role can read `auth.users`.
--   8. Privilege escalation by INSERT is refused.
--
-- Section 5 is the one that constrains the design most: `authenticated` has
-- SELECT only on every employer table, so a missing role check cannot be
-- exploited through PostgREST at all. That is a stronger guarantee than any
-- route check, and it would be lost silently by a future GRANT.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

-- 75 assertions. `set_config` calls do not consume a plan slot.
SELECT plan(75);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- Two candidates, one viewer/admin/recruiter/owner across two organizations.
-- Org A owns a published job that candidate 1 applied to. Org B owns a
-- different job, and the two orgs share no membership.

SELECT lives_ok($$INSERT INTO auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    ('fa000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'audit-owner-a@example.com', 'x', now(), now(), now()),
    ('fa000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'audit-admin-a@example.com', 'x', now(), now(), now()),
    ('fa000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'audit-recruiter-a@example.com', 'x', now(), now(), now()),
    ('fa000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'audit-viewer-a@example.com', 'x', now(), now(), now()),
    ('fa000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'audit-owner-b@example.com', 'x', now(), now(), now()),
    ('fb000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'audit-candidate-1@example.com', 'x', now(), now(), now()),
    ('fb000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'audit-candidate-2@example.com', 'x', now(), now(), now())
$$, 'auth users created for the audit actors');

SELECT lives_ok($$INSERT INTO public.profiles (id, full_name)
  SELECT u, 'Audit Actor'
  FROM unnest(ARRAY[
    'fa000000-0000-4000-8000-000000000001'::uuid,'fa000000-0000-4000-8000-000000000002'::uuid,
    'fa000000-0000-4000-8000-000000000003'::uuid,'fa000000-0000-4000-8000-000000000004'::uuid,
    'fa000000-0000-4000-8000-000000000005'::uuid,'fb000000-0000-4000-8000-000000000001'::uuid,
    'fb000000-0000-4000-8000-000000000002'::uuid]) AS u
  ON CONFLICT (id) DO NOTHING
$$, 'profiles created');

SELECT lives_ok($$INSERT INTO public.employer_organizations (id, name, owner_user_id, created_at)
  VALUES
    ('fc000000-0000-4000-8000-000000000001', 'Audit Org A', 'fa000000-0000-4000-8000-000000000001', now()),
    ('fc000000-0000-4000-8000-000000000002', 'Audit Org B', 'fa000000-0000-4000-8000-000000000005', now())
$$, 'two organizations created');

SELECT lives_ok($$INSERT INTO public.employer_members (org_id, user_id, role, created_at)
  VALUES
    ('fc000000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001', 'owner', now()),
    ('fc000000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000002', 'admin', now()),
    ('fc000000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000003', 'recruiter', now()),
    ('fc000000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000004', 'viewer', now()),
    ('fc000000-0000-4000-8000-000000000002', 'fa000000-0000-4000-8000-000000000005', 'owner', now())
$$, 'memberships created, with no overlap between the two orgs');

-- Publishing a job consumes a credit, so grant one first.
SELECT lives_ok($$INSERT INTO public.employer_job_post_credits (id, org_id, total, used, granted_at, expires_at)
  VALUES ('fd000000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', 5, 0, now(), now() + interval '1 year')
$$, 'job post credits granted');

SELECT lives_ok($$INSERT INTO public.employer_jobs (id, org_id, title, status, created_at, updated_at)
  VALUES ('fd000000-0000-4000-8000-00000000000a', 'fc000000-0000-4000-8000-000000000001', 'Audit Engineer', 'published', now(), now())
$$, 'a published job for org A');

SELECT lives_ok($$INSERT INTO public.credit_balances (user_id, wallet_balance_cents, interview_passes, updated_at)
  VALUES
    ('fb000000-0000-4000-8000-000000000001', 5000, 3, now()),
    ('fb000000-0000-4000-8000-000000000002', 9000, 7, now())
$$, 'two candidate wallets, deliberately different amounts');

SELECT lives_ok($$INSERT INTO public.job_opportunities
  (id, user_id, role_title, company_name, status, employer_job_id, created_at, updated_at)
  VALUES ('fe000000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001',
          'Engineer', 'Audit Acme', 'applied', 'fd000000-0000-4000-8000-00000000000a', now(), now())
$$, 'candidate 1 tracked an org A job');

SELECT lives_ok($$INSERT INTO public.applications
  (id, user_id, job_id, company_name, role_title, status, created_at, updated_at)
  VALUES ('ff000000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001',
          'fe000000-0000-4000-8000-000000000001', 'Audit Acme', 'Engineer', 'approved', now(), now())
$$, 'candidate 1 applied to the org A job');

SELECT lives_ok($$INSERT INTO public.interviews
  (id, user_id, company, role_title, status, created_at, updated_at)
  VALUES ('f9000000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001',
          'Audit Acme', 'Engineer', 'scheduled', now(), now())
$$, 'candidate 1 has an interview');

-- ---------------------------------------------------------------------------
-- Section 1 -- candidate cross-user isolation
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"fb000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT set_config('role', 'authenticated', true);

SELECT is((SELECT count(*)::int FROM public.profiles), 1,
  'a candidate sees exactly one profile row: their own');
SELECT is((SELECT count(*)::int FROM public.credit_balances), 1,
  'a candidate sees exactly one wallet row: their own');
SELECT is((SELECT count(*)::int FROM public.credit_balances
           WHERE user_id = 'fb000000-0000-4000-8000-000000000002'), 0,
  'a candidate cannot see another candidate''s wallet');
SELECT is((SELECT count(*)::int FROM public.interviews), 1,
  'a candidate sees only their own interviews');
SELECT is((SELECT count(*)::int FROM public.interviews
           WHERE user_id = 'fb000000-0000-4000-8000-000000000002'), 0,
  'a candidate cannot see another candidate''s interviews');

-- ---------------------------------------------------------------------------
-- Section 2 -- a candidate cannot reach an employer surface
-- ---------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM public.employer_organizations), 0,
  'a candidate sees no employer organizations');
SELECT is((SELECT count(*)::int FROM public.employer_members), 0,
  'a candidate sees no employer team rosters');
SELECT is((SELECT count(*)::int FROM public.employer_jobs), 0,
  'a candidate sees no employer jobs');
SELECT is((SELECT count(*)::int FROM public.employer_fit_scores), 0,
  'a candidate sees no employer Fit Scores');
SELECT is((SELECT count(*)::int FROM public.employer_subscriptions), 0,
  'a candidate sees no employer subscriptions');
SELECT is((SELECT count(*)::int FROM public.featured_listings), 0,
  'a candidate sees no featured listings');
SELECT is((SELECT count(*)::int FROM public.recruiter_seats), 0,
  'a candidate sees no recruiter seats');
SELECT is((SELECT count(*)::int FROM public.guest_access_records), 0,
  'a candidate sees no Guest Live access records');

-- ---------------------------------------------------------------------------
-- Section 3 -- an employer sees only their own organization
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"fa000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.employer_organizations
           WHERE id = 'fc000000-0000-4000-8000-000000000001'), 1,
  'a recruiter sees their own organization');
SELECT is((SELECT count(*)::int FROM public.employer_organizations
           WHERE id = 'fc000000-0000-4000-8000-000000000002'), 0,
  'a recruiter sees nothing of a different organization');
SELECT is((SELECT count(*)::int FROM public.employer_members
           WHERE org_id = 'fc000000-0000-4000-8000-000000000001'), 4,
  'a recruiter sees the full roster of their own organization');
SELECT is((SELECT count(*)::int FROM public.employer_members
           WHERE org_id = 'fc000000-0000-4000-8000-000000000002'), 0,
  'a recruiter sees no roster of a different organization');
SELECT is((SELECT count(*)::int FROM public.employer_jobs
           WHERE org_id = 'fc000000-0000-4000-8000-000000000002'), 0,
  'a recruiter sees no jobs of a different organization');

-- ---------------------------------------------------------------------------
-- Section 4 -- an employer cannot reach a candidate-private surface
-- ---------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM public.credit_balances), 0,
  'an employer cannot read any candidate wallet');
SELECT is((SELECT count(*)::int FROM public.interviews), 0,
  'an employer cannot read candidate interviews');
SELECT is((SELECT count(*)::int FROM public.live_interview_sessions), 0,
  'an employer cannot read Live sessions');
SELECT is((SELECT count(*)::int FROM public.live_transcript_items), 0,
  'an employer cannot read Live transcripts');
SELECT is((SELECT count(*)::int FROM public.post_interview_analyses), 0,
  'an employer cannot read post-interview analysis');
SELECT is((SELECT count(*)::int FROM public.notifications), 0,
  'an employer cannot read candidate notifications');
SELECT is((SELECT count(*)::int FROM public.follow_up_drafts), 0,
  'an employer cannot read candidate follow-up drafts');
SELECT is((SELECT count(*)::int FROM public.resumes), 0,
  'an employer cannot read the Resume Hub');
SELECT is((SELECT count(*)::int FROM public.live_memberships), 0,
  'an employer cannot read Live memberships');
SELECT is((SELECT count(*)::int FROM public.profiles), 1,
  'an employer actor sees only their own profile, not the candidate''s');
SELECT is((SELECT count(*)::int FROM public.profiles
           WHERE id = 'fb000000-0000-4000-8000-000000000001'), 0,
  'an employer cannot read a candidate''s profile row');
SELECT is((SELECT count(*)::int FROM public.applications), 0,
  'an employer cannot read the raw applications table');

-- ---------------------------------------------------------------------------
-- Section 5 -- no employer role can mutate employer tables directly
-- ---------------------------------------------------------------------------
-- This is the load-bearing structural claim: `authenticated` holds SELECT only
-- on every employer table, so a route that forgot a role check still cannot be
-- exploited through PostgREST. A future GRANT would break this silently.
SELECT ok(NOT has_table_privilege('authenticated', 'public.employer_organizations', 'INSERT'),
  'authenticated cannot insert an organization');
SELECT ok(NOT has_table_privilege('authenticated', 'public.employer_organizations', 'UPDATE'),
  'authenticated cannot update an organization');
SELECT ok(NOT has_table_privilege('authenticated', 'public.employer_jobs', 'INSERT'),
  'authenticated cannot insert a job');
SELECT ok(NOT has_table_privilege('authenticated', 'public.employer_jobs', 'UPDATE'),
  'authenticated cannot update a job');
SELECT ok(NOT has_table_privilege('authenticated', 'public.employer_members', 'INSERT'),
  'authenticated cannot insert a team member');
SELECT ok(NOT has_table_privilege('authenticated', 'public.employer_members', 'UPDATE'),
  'authenticated cannot update a team member');
SELECT ok(NOT has_table_privilege('authenticated', 'public.employer_members', 'DELETE'),
  'authenticated cannot delete a team member');
SELECT ok(NOT has_table_privilege('authenticated', 'public.employer_pipeline_stages', 'INSERT'),
  'authenticated cannot forge a pipeline transition');
SELECT ok(NOT has_table_privilege('authenticated', 'public.employer_fit_scores', 'INSERT'),
  'authenticated cannot write a Fit Score');
SELECT ok(has_table_privilege('service_role', 'public.employer_jobs', 'INSERT'),
  'service_role retains the write path the routes use');

-- ---------------------------------------------------------------------------
-- Section 6 -- a candidate cannot grant themselves money
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"fb000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- `throws_ok` needs the SQLSTATE. Its two-argument form is (sql, message), so
-- a bare description would be compared against the error text and never match.
SELECT throws_ok($$UPDATE public.credit_balances
                    SET wallet_balance_cents = 999999
                  WHERE user_id = 'fb000000-0000-4000-8000-000000000001'$$,
  '42501', NULL, 'a candidate cannot top up their own wallet');
SELECT throws_ok($$UPDATE public.credit_balances
                    SET interview_passes = 999
                  WHERE user_id = 'fb000000-0000-4000-8000-000000000001'$$,
  '42501', NULL, 'a candidate cannot grant themselves interview passes');
SELECT is((SELECT wallet_balance_cents FROM public.credit_balances
           WHERE user_id = 'fb000000-0000-4000-8000-000000000001'), 5000,
  'the wallet balance is unchanged after both attempts');
SELECT is((SELECT interview_passes FROM public.credit_balances
           WHERE user_id = 'fb000000-0000-4000-8000-000000000001'), 3,
  'the interview pass count is unchanged after both attempts');

-- ---------------------------------------------------------------------------
-- Section 7 -- privilege escalation by INSERT
-- ---------------------------------------------------------------------------
SELECT throws_ok($$INSERT INTO public.employer_organizations (id, name, owner_user_id, created_at)
                    VALUES ('f0000000-0000-4000-8000-0000000000ff', 'Stolen',
                            'fa000000-0000-4000-8000-000000000001', now())$$,
  '42501', NULL, 'a candidate cannot create an organization owned by someone else');
SELECT throws_ok($$INSERT INTO public.employer_members (org_id, user_id, role, created_at)
                    VALUES ('fc000000-0000-4000-8000-000000000001',
                            'fb000000-0000-4000-8000-000000000001', 'owner', now())$$,
  '42501', NULL, 'a candidate cannot add themselves to an organization as its owner');
-- This one is refused by the RLS WITH CHECK rather than by a missing grant,
-- because the owner does hold INSERT on their own guest records. Either way the
-- SQLSTATE is insufficient_privilege, and the point is that `owner_user_id` is
-- scoped to the caller.
SELECT throws_ok($$INSERT INTO public.guest_access_records
                    (id, owner_user_id, token_sha256, status, created_at, updated_at)
                    VALUES ('f0000000-0000-4000-8000-0000000000fe',
                            'fa000000-0000-4000-8000-000000000001', 'deadbeef', 'pending', now(), now())$$,
  '42501', NULL, 'a candidate cannot mint a Guest Live link charged to another owner');
SELECT set_config('request.jwt.claims',
  '{"sub":"fa000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
SELECT throws_ok($$UPDATE public.employer_members SET role = 'owner'
                    WHERE user_id = 'fa000000-0000-4000-8000-000000000003'$$,
  '42501', NULL, 'an employer cannot promote themselves to owner');

-- ---------------------------------------------------------------------------
-- Section 8 -- anonymous access, and auth.users
-- ---------------------------------------------------------------------------
-- Anonymous is asserted by the *exception*, not by an empty count. Anonymous
-- holds no SELECT grant at all, so a plain `count(*)` would raise and abort the
-- whole transaction rather than returning zero -- and "cannot read the table" is
-- the stronger claim than "reads nothing from it".
SELECT set_config('role', 'anon', true);
SELECT throws_ok($$SELECT count(*) FROM public.profiles$$,
  '42501', NULL, 'anonymous cannot read profiles at all');
SELECT throws_ok($$SELECT count(*) FROM public.credit_balances$$,
  '42501', NULL, 'anonymous cannot read wallets at all');
SELECT throws_ok($$SELECT count(*) FROM public.employer_jobs$$,
  '42501', NULL, 'anonymous cannot read employer jobs at all');
SELECT throws_ok($$SELECT count(*) FROM public.applications$$,
  '42501', NULL, 'anonymous cannot read applications at all');
SELECT throws_ok($$SELECT count(*) FROM public.interviews$$,
  '42501', NULL, 'anonymous cannot read interviews at all');
SELECT set_config('role', 'none', true);

SELECT ok(NOT has_table_privilege('anon', 'public.profiles', 'SELECT'),
  'anon holds no SELECT on profiles');
SELECT ok(NOT has_table_privilege('anon', 'public.credit_balances', 'SELECT'),
  'anon holds no SELECT on credit balances');
SELECT ok(NOT has_table_privilege('anon', 'public.employer_jobs', 'SELECT'),
  'anon holds no SELECT on employer jobs');
SELECT ok(NOT has_table_privilege('anon', 'public.applications', 'SELECT'),
  'anon holds no SELECT on applications');
SELECT ok(NOT has_table_privilege('anon', 'public.interviews', 'SELECT'),
  'anon holds no SELECT on interviews');
SELECT ok(NOT has_table_privilege('anon', 'public.guest_access_records', 'SELECT'),
  'anon holds no SELECT on guest access records');
SELECT ok(NOT has_table_privilege('authenticated', 'auth.users', 'SELECT'),
  'authenticated cannot read auth.users directly');
SELECT ok(NOT has_table_privilege('anon', 'auth.users', 'SELECT'),
  'anon cannot read auth.users directly');
SELECT ok(has_table_privilege('anon', 'public.pricing_products', 'SELECT'),
  'anon retains SELECT on the public pricing catalogue');

-- Guest Live is server-mediated: anonymous must not be able to reach the
-- applicant surfaces it stands in front of.
SELECT ok(NOT has_function_privilege('anon',
    'public.odesseus_get_employer_applicant_identities(uuid, uuid)', 'EXECUTE'),
  'anon cannot execute the applicant-identity reader');
SELECT ok(NOT has_function_privilege('anon',
    'public.odesseus_get_employer_applicants(uuid, uuid)', 'EXECUTE'),
  'anon cannot execute the applicant-payload reader');

-- ---------------------------------------------------------------------------
-- Section 9 -- the identity reader returns no candidate-private key
-- ---------------------------------------------------------------------------
-- Structural, not behavioural: a reader that also returned a user id would
-- still pass every "cross-org is denied" assertion above, so the return type
-- itself is checked.
SELECT is(
  (SELECT pg_get_function_result(p.oid)
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'odesseus_get_employer_applicant_identities'),
  'TABLE(application_id uuid, candidate_name text, candidate_email text)',
  'the identity reader returns exactly three columns and no user id'
);

SELECT * FROM finish();
ROLLBACK;
