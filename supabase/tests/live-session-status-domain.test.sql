-- Live interview session status domain (pgTAP).
-- Run with: npx supabase test db
--
-- live_interview_sessions.status shipped a four-value CHECK
-- (prepared|active|ended|failed) while the shipped lifecycle writes and reads
-- six more. Creating a Live session therefore raised a CHECK violation, so
-- Odesseus Live could not start at all. This file proves the corrected
-- constraint:
--
--   * every status the lifecycle can produce is accepted,
--   * a status outside the domain is rejected,
--   * the old four-value domain is still entirely valid (no historical row is
--     invalidated by widening),
--   * the in-flight predicate agrees with the constraint.
--
-- The full Live entitlement/payment behaviour is covered by live-guests.test.sql
-- and the Phase 11A lifecycle work; this file only exercises the status domain.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(39);

SELECT lives_ok($$INSERT INTO auth.users (id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES ('eeeeeeee-7777-4777-8777-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'live-status-u1@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create user');

SELECT lives_ok($$INSERT INTO public.job_opportunities (id, user_id, company_name, role_title)
  VALUES ('eeeeeeee-8888-4888-8888-000000000001', 'eeeeeeee-7777-4777-8777-000000000001',
    'LiveCo', 'Engineer')$$,
  'create job');

SELECT lives_ok($$INSERT INTO public.applications (id, user_id, job_id, company_name, role_title)
  VALUES ('eeeeeeee-9999-4999-8999-000000000001', 'eeeeeeee-7777-4777-8777-000000000001',
    'eeeeeeee-8888-4888-8888-000000000001', 'LiveCo', 'Engineer')$$,
  'create application');

SELECT lives_ok($$INSERT INTO public.interviews (id, user_id, application_id, status)
  VALUES ('eeeeeeee-bbbb-4bbb-8bbb-000000000001', 'eeeeeeee-7777-4777-8777-000000000001',
    'eeeeeeee-9999-4999-8999-000000000001', 'ready')$$,
  'create interview');

-- ---------------------------------------------------------------------------
-- Every status in the authoritative domain is accepted.
--
-- One row per status, paired user-n to status-n, because
-- live_interview_sessions has a UNIQUE index on interview_id
-- (live_interview_sessions_interview_id_key): an interview carries at most one
-- Live session, so each status needs its own interview. A single INSERT that
-- gave every user every status would be rejected on the unique index rather
-- than on the CHECK, which would prove nothing about the status domain.
-- ---------------------------------------------------------------------------
SELECT lives_ok($$INSERT INTO auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'live-status-' || n || '@example.com', 'not-a-real-password',
    now(), now(), now()
  FROM generate_series(1, 10) n$$,
  'create one user per status in the domain');

SELECT lives_ok($$INSERT INTO public.job_opportunities (user_id, company_name, role_title)
  SELECT u.id, 'LiveCo', 'Engineer' FROM auth.users u
  WHERE u.email like 'live-status-%@example.com'$$,
  'create a job for each status user');

SELECT lives_ok($$INSERT INTO public.applications (user_id, job_id, company_name, role_title)
  SELECT u.id, j.id, 'LiveCo', 'Engineer'
  FROM auth.users u
  JOIN public.job_opportunities j ON j.user_id = u.id
  WHERE u.email like 'live-status-%@example.com'$$,
  'create an application for each status user');

SELECT lives_ok($$INSERT INTO public.interviews (user_id, application_id, status)
  SELECT u.id, a.id, 'ready'
  FROM auth.users u
  JOIN public.applications a ON a.user_id = u.id
  WHERE u.email like 'live-status-%@example.com'$$,
  'create an interview for each status user');

SELECT lives_ok($$INSERT INTO public.live_interview_sessions
  (user_id, application_id, interview_id, status, capture_mode)
  SELECT u.id, a.id, i.id, w.status, 'microphone'
  FROM (VALUES
    (1,  'prepared'),         (2,  'ready'),       (3,  'payment_required'),
    (4,  'starting'),         (5,  'active'),      (6,  'recovering'),
    (7,  'completed'),        (8,  'failed'),      (9,  'expired'),
    (10, 'ended')
  ) AS w(n, status)
  JOIN auth.users u ON u.email = 'live-status-' || w.n || '@example.com'
  JOIN public.applications a ON a.user_id = u.id
  JOIN public.interviews i ON i.application_id = a.id$$,
  'every status in the authoritative domain is accepted on insert');

SELECT is(
  (SELECT count(*) FROM public.live_interview_sessions s
    JOIN auth.users u ON u.id = s.user_id
   WHERE u.email like 'live-status-%@example.com'),
  10::bigint,
  'all ten statuses are stored'
);

-- -----------------------------------------------------------------------
-- Historical rows remain valid.
--
-- The fix widened the constraint, so nothing the original four-value domain
-- accepted may have become invalid. The strongest available proof is to write
-- the old domain for real: four rows, on users that exist only for this check,
-- carrying exactly the statuses the v0.11 baseline permitted. If the new CHECK
-- had dropped or spelled anything differently, these inserts would fail.
-- -----------------------------------------------------------------------

SELECT lives_ok($$INSERT INTO auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'legacy-' || n || '@example.com', 'not-a-real-password',
    now(), now(), now()
  FROM generate_series(1, 4) n$$,
  'create one user per baseline status');

SELECT lives_ok($$INSERT INTO public.job_opportunities (user_id, company_name, role_title)
  SELECT u.id, 'LegacyCo', 'Engineer' FROM auth.users u
  WHERE u.email like 'legacy-%@example.com'$$,
  'create a job for each baseline user');

SELECT lives_ok($$INSERT INTO public.applications (user_id, job_id, company_name, role_title)
  SELECT u.id, j.id, 'LegacyCo', 'Engineer'
  FROM auth.users u
  JOIN public.job_opportunities j ON j.user_id = u.id
  WHERE u.email like 'legacy-%@example.com'$$,
  'create an application for each baseline user');

SELECT lives_ok($$INSERT INTO public.interviews (user_id, application_id, status)
  SELECT u.id, a.id, 'ready'
  FROM auth.users u
  JOIN public.applications a ON a.user_id = u.id
  WHERE u.email like 'legacy-%@example.com'$$,
  'create an interview for each baseline user');

SELECT lives_ok($$INSERT INTO public.live_interview_sessions
  (user_id, application_id, interview_id, status, capture_mode)
  SELECT u.id, a.id, i.id, w.status, 'microphone'
  FROM (VALUES (1, 'prepared'), (2, 'active'), (3, 'ended'), (4, 'failed'))
       AS w(n, status)
  JOIN auth.users u ON u.email = 'legacy-' || w.n || '@example.com'
  JOIN public.applications a ON a.user_id = u.id
  JOIN public.interviews i ON i.application_id = a.id$$,
  'every status in the original four-value baseline domain is still accepted');

SELECT is(
  (SELECT count(*) FROM public.live_interview_sessions s
    JOIN auth.users u ON u.id = s.user_id
   WHERE u.email like 'legacy-%@example.com'
     AND s.status IN ('prepared', 'active', 'ended', 'failed')),
  4::bigint,
  'all four baseline statuses are stored unchanged, so no historical row is invalidated'
);

-- ---------------------------------------------------------------------------
-- The domain is closed.
-- ---------------------------------------------------------------------------

SELECT throws_ok(
  $$INSERT INTO public.live_interview_sessions
      (user_id, application_id, interview_id, status, capture_mode)
    VALUES ('eeeeeeee-7777-4777-8777-000000000001',
      'eeeeeeee-9999-4999-8999-000000000001',
      'eeeeeeee-bbbb-4bbb-8bbb-000000000001', 'live', 'microphone')$$,
  '23514'::text,
  NULL::text,
  'a status outside the domain is rejected'
);

SELECT throws_ok(
  $$INSERT INTO public.live_interview_sessions
      (user_id, application_id, interview_id, status, capture_mode)
    VALUES ('eeeeeeee-7777-4777-8777-000000000001',
      'eeeeeeee-9999-4999-8999-000000000001',
      'eeeeeeee-bbbb-4bbb-8bbb-000000000001', 'ready_to_submit', 'microphone')$$,
  '23514'::text,
  NULL::text,
  'an application_runs status is not a Live session status'
);

SELECT throws_ok(
  $$INSERT INTO public.live_interview_sessions
      (user_id, application_id, interview_id, status, capture_mode)
    VALUES ('eeeeeeee-7777-4777-8777-000000000001',
      'eeeeeeee-9999-4999-8999-000000000001',
      'eeeeeeee-bbbb-4bbb-8bbb-000000000001', 'READY', 'microphone')$$,
  '23514'::text,
  NULL::text,
  'the domain is case sensitive, so a differently-cased status is not accepted'
);

-- A status is mutable across the lifecycle, and any domain member is a legal
-- destination. Updating is how the lifecycle actually moves a session.
SELECT lives_ok($$UPDATE public.live_interview_sessions
  SET status = 'starting'
  WHERE id = (SELECT s.id FROM public.live_interview_sessions s
                JOIN auth.users u ON u.id = s.user_id
               WHERE u.email = 'live-status-1@example.com')$$,
  'a session can move from prepared to starting');

SELECT is(
  (SELECT status FROM public.live_interview_sessions s
    JOIN auth.users u ON u.id = s.user_id
   WHERE u.email = 'live-status-1@example.com'),
  'starting'::text,
  'the update landed'
);

SELECT throws_ok(
  $$UPDATE public.live_interview_sessions
      SET status = 'reconnecting'
    WHERE id = (SELECT s.id FROM public.live_interview_sessions s
                  JOIN auth.users u ON u.id = s.user_id
                 WHERE u.email = 'live-status-1@example.com')$$,
  '23514'::text,
  NULL::text,
  'an invented status is rejected on update as well as insert'
);

-- ---------------------------------------------------------------------------
-- The in-flight predicate agrees with the constraint.
-- ---------------------------------------------------------------------------

SELECT is(
  (SELECT count(*) FROM (VALUES ('ready'), ('starting'), ('active'), ('recovering'))
       AS d(status)
   WHERE NOT public.odesseus_live_session_is_in_flight(d.status)),
  0::bigint,
  'every in-flight status is reported in flight'
);

SELECT is(
  (SELECT count(*) FROM (VALUES ('prepared'), ('payment_required'), ('completed'),
                         ('failed'), ('expired'), ('ended'))
       AS d(status)
   WHERE public.odesseus_live_session_is_in_flight(d.status)),
  0::bigint,
  'no terminal or dead-end status is reported in flight'
);

-- The rate limit used to count only ('active', 'completed', 'recovering'), so
-- every status the new domain added was invisible to it. A user could prepare
-- and fail repeatedly, and each attempt was a row the ceiling never counted.
-- It now counts everything in flight, plus completed, which is the set the
-- window was always meant to bound.
--
-- Each user below holds exactly one session, so max_sessions = 1 turns "does
-- this status count against the ceiling" into a single boolean per status.
SELECT ok(
  public.odesseus_check_live_rate_limit(
    'eeeeeeee-7777-4777-8777-000000000001', 60, 1),
  'a user with no sessions in the window is under the limit'
);

SELECT ok(
  NOT public.odesseus_check_live_rate_limit(
    'eeeeeeee-7777-4777-8777-000000000001', 60, 0),
  'a ceiling of zero is reached by an empty window'
);

SELECT ok(
  NOT public.odesseus_check_live_rate_limit(
    (SELECT u.id FROM auth.users u WHERE u.email = 'live-status-1@example.com'), 60, 1),
  'a starting session counts against the ceiling'
);

SELECT ok(
  public.odesseus_check_live_rate_limit(
    (SELECT u.id FROM auth.users u WHERE u.email = 'live-status-1@example.com'), 60, 2),
  'one session is still under a ceiling of two'
);

SELECT ok(
  NOT public.odesseus_check_live_rate_limit(
    (SELECT u.id FROM auth.users u WHERE u.email = 'live-status-2@example.com'), 60, 1),
  'a ready session counts against the ceiling (this status was previously rejected by the CHECK entirely)'
);

SELECT ok(
  NOT public.odesseus_check_live_rate_limit(
    (SELECT u.id FROM auth.users u WHERE u.email = 'live-status-4@example.com'), 60, 1),
  'a second starting session counts against the ceiling'
);

SELECT ok(
  NOT public.odesseus_check_live_rate_limit(
    (SELECT u.id FROM auth.users u WHERE u.email = 'live-status-5@example.com'), 60, 1),
  'an active session counts against the ceiling'
);

SELECT ok(
  NOT public.odesseus_check_live_rate_limit(
    (SELECT u.id FROM auth.users u WHERE u.email = 'live-status-6@example.com'), 60, 1),
  'a recovering session counts against the ceiling'
);

SELECT ok(
  NOT public.odesseus_check_live_rate_limit(
    (SELECT u.id FROM auth.users u WHERE u.email = 'live-status-7@example.com'), 60, 1),
  'a completed session still counts against the ceiling'
);

SELECT ok(
  public.odesseus_check_live_rate_limit(
    (SELECT u.id FROM auth.users u WHERE u.email = 'live-status-3@example.com'), 60, 1),
  'a payment_required session does not consume the ceiling, because no pass was ever spent'
);

SELECT ok(
  public.odesseus_check_live_rate_limit(
    (SELECT u.id FROM auth.users u WHERE u.email = 'live-status-8@example.com'), 60, 1),
  'a failed session does not consume the ceiling'
);

SELECT ok(
  public.odesseus_check_live_rate_limit(
    (SELECT u.id FROM auth.users u WHERE u.email = 'live-status-9@example.com'), 60, 1),
  'an expired session does not consume the ceiling'
);

SELECT ok(
  public.odesseus_check_live_rate_limit(
    (SELECT u.id FROM auth.users u WHERE u.email = 'live-status-10@example.com'), 60, 1),
  'an ended session does not consume the ceiling'
);

SELECT ok(
  NOT public.odesseus_check_live_rate_limit(
    (SELECT u.id FROM auth.users u WHERE u.email = 'legacy-2@example.com'), 60, 1),
  'a baseline-era active session still counts against the ceiling'
);

SELECT has_index(
  'public',
  'live_interview_sessions',
  'live_interview_sessions_status_created_idx',
  ARRAY['status', 'created_at'],
  'session status reads are indexed for the candidate Live page and admin browser'
);

SELECT * FROM finish();
ROLLBACK;
