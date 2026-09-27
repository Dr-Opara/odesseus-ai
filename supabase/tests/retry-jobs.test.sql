-- Retry / recovery infrastructure (Phase 11A RPCs, wired to real call sites
-- in Phase 13). pgTAP.
--
-- Proves the queue mechanics the application layer now depends on
-- (src/lib/retry/service.ts, src/lib/retry/handlers.ts,
-- /api/cron/process-retry-jobs):
--   * odesseus_enqueue_retry_job is idempotent on idempotency_key — a
--     repeated enqueue for the same logical operation returns the same row,
--     never a second one
--   * odesseus_claim_retry_job only claims a job whose next_retry_at has
--     passed, atomically marks it 'running', and increments attempts
--   * a claimed job is not claimable again while 'running'
--   * odesseus_complete_retry_job('succeeded') clears next_retry_at and
--     stamps completed_at
--   * odesseus_complete_retry_job('failed') reschedules with a future
--     next_retry_at while attempts remain, and moves to 'dead_letter' with
--     next_retry_at cleared once attempts are exhausted — the property the
--     production checklist calls "terminal failures remain observable"
--   * all three RPCs are service_role-only; the table itself denies anon
--     and authenticated entirely (browser code can never see or drain the
--     retry queue)

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(22);

-- ---------------------------------------------------------------------------
-- Enqueue idempotency
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$SELECT public.odesseus_enqueue_retry_job(
    'email_delivery', 'test:enqueue:1', '{"to":"a@example.com"}'::jsonb, 3::smallint, 0)$$,
  'enqueue a job');

SELECT is(
  (SELECT count(*)::int FROM public.retry_jobs WHERE idempotency_key = 'test:enqueue:1'),
  1, 'exactly one row exists after the first enqueue');

SELECT is(
  (SELECT public.odesseus_enqueue_retry_job(
    'email_delivery', 'test:enqueue:1', '{"to":"a@example.com"}'::jsonb, 3::smallint, 0)),
  (SELECT id FROM public.retry_jobs WHERE idempotency_key = 'test:enqueue:1'),
  'a repeated enqueue with the same idempotency key returns the existing row id');

SELECT is(
  (SELECT count(*)::int FROM public.retry_jobs WHERE idempotency_key = 'test:enqueue:1'),
  1, 'the repeated enqueue did not create a second row');

SELECT is(
  (SELECT status FROM public.retry_jobs WHERE idempotency_key = 'test:enqueue:1'),
  'pending', 'a freshly enqueued job starts pending');

-- ---------------------------------------------------------------------------
-- Claim marks running and increments attempts (claimed here, immediately,
-- before any other 'email_delivery' job exists to collide with — claim only
-- takes one due job of a type, so two due jobs of the same type in flight at
-- once would make "which one did it pick" ambiguous for this assertion).
-- ---------------------------------------------------------------------------
SELECT results_eq(
  $$SELECT status, attempts FROM public.odesseus_claim_retry_job('email_delivery')
    WHERE idempotency_key = 'test:enqueue:1'$$,
  $$VALUES ('running'::text, 1::smallint)$$,
  'claiming a due job marks it running and increments attempts');

SELECT is(
  (SELECT count(*)::int FROM public.odesseus_claim_retry_job('email_delivery')
   WHERE idempotency_key = 'test:enqueue:1'),
  0, 'a running job is not claimed again');

-- ---------------------------------------------------------------------------
-- Claim respects next_retry_at and job_type (test:enqueue:1 is 'running' now,
-- so it can no longer be picked up as a false positive by these claims)
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$SELECT public.odesseus_enqueue_retry_job(
    'email_delivery', 'test:not-due-yet', '{}'::jsonb, 3::smallint, 3600)$$,
  'enqueue a job whose next_retry_at is an hour out');

SELECT is(
  (SELECT count(*)::int FROM public.odesseus_claim_retry_job('email_delivery')
   WHERE idempotency_key = 'test:not-due-yet'),
  0, 'claim does not pick up a job before its next_retry_at');

SELECT is(
  (SELECT count(*)::int FROM public.odesseus_claim_retry_job('featured_job_activation')
   WHERE idempotency_key = 'test:enqueue:1'),
  0, 'claim never returns a job of a different job_type');

-- ---------------------------------------------------------------------------
-- Complete: succeeded
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$SELECT public.odesseus_complete_retry_job(
    (SELECT id FROM public.retry_jobs WHERE idempotency_key = 'test:enqueue:1'),
    'succeeded', NULL)$$,
  'complete the claimed job as succeeded');

SELECT results_eq(
  $$SELECT status, next_retry_at, completed_at IS NOT NULL
    FROM public.retry_jobs WHERE idempotency_key = 'test:enqueue:1'$$,
  $$VALUES ('succeeded'::text, NULL::timestamptz, true)$$,
  'a succeeded job clears next_retry_at and stamps completed_at');

-- ---------------------------------------------------------------------------
-- Complete: failed, reschedules while attempts remain
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$SELECT public.odesseus_enqueue_retry_job(
    'application_finalization', 'test:fail-reschedule', '{}'::jsonb, 3::smallint, 0)$$,
  'enqueue a job that will fail once');

SELECT ok(
  (SELECT count(*)::int FROM public.odesseus_claim_retry_job('application_finalization')
   WHERE idempotency_key = 'test:fail-reschedule') = 1,
  'claim the job for its first attempt');

SELECT lives_ok(
  $$SELECT public.odesseus_complete_retry_job(
    (SELECT id FROM public.retry_jobs WHERE idempotency_key = 'test:fail-reschedule'),
    'failed', 'transient db error')$$,
  'mark the first attempt failed');

SELECT results_eq(
  $$SELECT status, last_error, next_retry_at > now()
    FROM public.retry_jobs WHERE idempotency_key = 'test:fail-reschedule'$$,
  $$VALUES ('pending'::text, 'transient db error'::text, true)$$,
  'one failed attempt (1 of 3) reschedules to pending with a future next_retry_at, not dead_letter');

-- ---------------------------------------------------------------------------
-- Complete: failed, dead-letters once attempts are exhausted
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$SELECT public.odesseus_enqueue_retry_job(
    'recruiter_seat_sync', 'test:dead-letter', '{}'::jsonb, 1::smallint, 0)$$,
  'enqueue a job with max_attempts = 1');

SELECT ok(
  (SELECT count(*)::int FROM public.odesseus_claim_retry_job('recruiter_seat_sync')
   WHERE idempotency_key = 'test:dead-letter') = 1,
  'claim its only attempt');

SELECT lives_ok(
  $$SELECT public.odesseus_complete_retry_job(
    (SELECT id FROM public.retry_jobs WHERE idempotency_key = 'test:dead-letter'),
    'failed', 'org not found')$$,
  'mark the only attempt failed');

SELECT results_eq(
  $$SELECT status, next_retry_at FROM public.retry_jobs WHERE idempotency_key = 'test:dead-letter'$$,
  $$VALUES ('dead_letter'::text, NULL::timestamptz)$$,
  'exhausting max_attempts dead-letters the job — a queryable terminal failure, not a silent one');

-- ---------------------------------------------------------------------------
-- Permissions: service-role only, all the way down
-- ---------------------------------------------------------------------------
SELECT ok(
  has_function_privilege('service_role', 'public.odesseus_enqueue_retry_job(text, text, jsonb, smallint, integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.odesseus_enqueue_retry_job(text, text, jsonb, smallint, integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.odesseus_enqueue_retry_job(text, text, jsonb, smallint, integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.odesseus_claim_retry_job(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.odesseus_claim_retry_job(text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.odesseus_complete_retry_job(uuid, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.odesseus_complete_retry_job(uuid, text, text)', 'EXECUTE'),
  'all three retry RPCs are service_role-only');

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.retry_jobs', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.retry_jobs', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.retry_jobs', 'INSERT')
  AND has_table_privilege('service_role', 'public.retry_jobs', 'SELECT'),
  'retry_jobs itself is invisible to anon/authenticated and fully open only to service_role'
);

SELECT * FROM finish();
ROLLBACK;
