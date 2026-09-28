-- Candidate activity events and dashboard counts (pgTAP).
-- Run with: npx supabase test db
--
-- Two claims are under test here.
--
-- 1. The activity stream is written by the transition that caused it, and only
--    by that transition. Re-asserting a value writes no second line, because a
--    feed that double-counts a hold is worse than one that misses it: the
--    candidate is the one reading it.
--
-- 2. The dashboard counts are exact, and are the candidate's own. A count that
--    leaks another tenant's rows, or that reports a sample as a total, is the
--    exact defect this milestone exists to remove, so both are asserted
--    directly rather than inferred from the service.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(58);

-- Two candidates. Everything below is created for both, and the assertions
-- about the first are only meaningful if the second's rows are present and
-- different.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES
  ('e1e10000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'act-a@example.test', 'x', now(), now(), now()),
  ('e1e10000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'act-b@example.test', 'x', now(), now(), now());

-- ---------------------------------------------------------------------------
-- 1. Vocabulary
-- ---------------------------------------------------------------------------
-- The CHECK is the contract. Seventeen values, no more, no fewer, and a type
-- that nothing produces is a value that only widens the domain.

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
    WHERE conname = 'candidate_activity_events_event_type_check'),
  1,
  'the event_type domain is enforced by a single CHECK constraint'
);

SELECT throws_ok(
  $$insert into public.candidate_activity_events
      (user_id, event_type, title, entity_type, entity_id)
    values ('e1e10000-0000-4000-8000-000000000001', 'email_detected', 'x', 'resume', gen_random_uuid())$$,
  '23514',
  'new row for relation "candidate_activity_events" violates check constraint "candidate_activity_events_event_type_check"',
  'the vocabulary is closed, so an integration-derived type cannot be smuggled in'
);

SELECT throws_ok(
  $$insert into public.candidate_activity_events
      (user_id, event_type, title, entity_type, entity_id)
    values ('e1e10000-0000-4000-8000-000000000001', 'application_submitted', '   ', 'application', gen_random_uuid())$$,
  '23514',
  'new row for relation "candidate_activity_events" violates check constraint "candidate_activity_events_title_check"',
  'a feed line with no title is a blank line'
);

-- ---------------------------------------------------------------------------
-- 2. Match and save
-- ---------------------------------------------------------------------------

INSERT INTO public.job_opportunities (id, user_id, company_name, role_title, match_score, status)
VALUES ('e1e10000-0000-4000-8000-000000000010', 'e1e10000-0000-4000-8000-000000000001', 'Acme', 'Engineer', 90, 'discovered');

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'job_matched' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  'a job scored for the first time records one match'
);

-- Re-scoring happens constantly: the matcher reruns, the score moves. That is
-- not a new job and must not become a second line in the feed.
UPDATE public.job_opportunities SET match_score = 94
 WHERE id = 'e1e10000-0000-4000-8000-000000000010';

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'job_matched' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  're-scoring an already-matched job does not record a second match'
);

UPDATE public.job_opportunities SET status = 'saved'
 WHERE id = 'e1e10000-0000-4000-8000-000000000010';

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'job_saved' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  'saving a job records one save'
);

UPDATE public.job_opportunities SET status = 'saved'
 WHERE id = 'e1e10000-0000-4000-8000-000000000010';

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'job_saved' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  'saving an already-saved job records nothing'
);

-- A job discovered without a score is not a match.
INSERT INTO public.job_opportunities (id, user_id, company_name, role_title, status)
VALUES ('e1e10000-0000-4000-8000-000000000011', 'e1e10000-0000-4000-8000-000000000001', 'Beta', 'Analyst', 'discovered');

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'job_matched' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  'a job discovered without a score is not a match'
);

-- ---------------------------------------------------------------------------
-- 3. Resume
-- ---------------------------------------------------------------------------

INSERT INTO public.resumes (id, user_id, file_name, is_master)
VALUES ('e1e10000-0000-4000-8000-000000000020', 'e1e10000-0000-4000-8000-000000000001', 'cv.pdf', true);

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'resume_uploaded' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  'an uploaded resume is recorded'
);

INSERT INTO public.resume_tailorings (id, user_id, job_id, source_resume_id, version_number, status, tailored_resume, changes)
VALUES ('e1e10000-0000-4000-8000-000000000030', 'e1e10000-0000-4000-8000-000000000001',
        'e1e10000-0000-4000-8000-000000000010', 'e1e10000-0000-4000-8000-000000000020', 1, 'draft', '{}', '[]');

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'resume_optimized' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  0,
  'a draft tailoring is not a finished resume'
);

UPDATE public.resume_tailorings SET status = 'approved'
 WHERE id = 'e1e10000-0000-4000-8000-000000000030';

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'resume_optimized' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  'approving a tailoring records the optimized resume'
);

UPDATE public.resume_tailorings SET status = 'approved'
 WHERE id = 'e1e10000-0000-4000-8000-000000000030';

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'resume_optimized' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  're-approving the same tailoring records nothing'
);

-- ---------------------------------------------------------------------------
-- 4. The application run lifecycle
-- ---------------------------------------------------------------------------

INSERT INTO public.application_runs (id, user_id, job_id, approved_resume_id, target_url, execution_mode, status)
VALUES ('e1e10000-0000-4000-8000-000000000040', 'e1e10000-0000-4000-8000-000000000001',
        'e1e10000-0000-4000-8000-000000000010', 'e1e10000-0000-4000-8000-000000000020',
        'https://acme.test/apply', 'standard', 'queued');

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'application_queued' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  'queueing a run records it'
);

UPDATE public.application_runs SET status = 'ready_to_submit'
 WHERE id = 'e1e10000-0000-4000-8000-000000000040';

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'application_needs_review' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  'a run that is ready to send records that it is waiting on review'
);

-- The default sync trigger turns an empty hold into needs_review, so this step
-- is a run asking for a decision, not a run that is stuck.
UPDATE public.application_runs SET status = 'needs_user'
 WHERE id = 'e1e10000-0000-4000-8000-000000000040';

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'application_needs_input' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  'a run stopped for a decision records that it needs input'
);

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'application_held' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  0,
  'a decision stop is not reported as a hold'
);

-- The important case: the agent discovers a CAPTCHA after the run already asked
-- for a decision. That is an UPDATE that leaves status alone.
UPDATE public.application_runs SET hold_category = 'captcha_required', stop_reason = 'CAPTCHA_REQUIRED'
 WHERE id = 'e1e10000-0000-4000-8000-000000000040';

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'application_held' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  'escalating a decision stop to a real hold records the hold even though status did not change'
);

UPDATE public.application_runs SET hold_category = 'captcha_required', stop_reason = 'CAPTCHA_REQUIRED'
 WHERE id = 'e1e10000-0000-4000-8000-000000000040';

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'application_held' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  're-asserting the same hold records nothing'
);

-- Setting status and hold together is one statement and must be one line.
UPDATE public.application_runs SET status = 'queued', hold_category = null
 WHERE id = 'e1e10000-0000-4000-8000-000000000040';
UPDATE public.application_runs SET status = 'needs_user', hold_category = 'mfa_required'
 WHERE id = 'e1e10000-0000-4000-8000-000000000040';

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'application_held' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  2,
  'one statement that sets status and hold together records exactly one more line'
);

-- ---------------------------------------------------------------------------
-- 5. Submission and verification
-- ---------------------------------------------------------------------------
-- The one path that is not already unique per event: re-finalizing a run
-- UPDATEs the application and restamps submitted_at.

INSERT INTO public.applications (id, user_id, job_id, company_name, role_title, status, submitted_at, verification_evidence)
VALUES ('e1e10000-0000-4000-8000-000000000050', 'e1e10000-0000-4000-8000-000000000001',
        'e1e10000-0000-4000-8000-000000000010', 'Acme', 'Engineer', 'applied', now(), '{"confirmation":"abc"}'::jsonb);

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'application_submitted' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  'a submitted application is recorded'
);

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'application_verified' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  'a submission carrying evidence is recorded as verified'
);

UPDATE public.applications SET submitted_at = now(), verification_evidence = '{"confirmation":"abc"}'::jsonb
 WHERE id = 'e1e10000-0000-4000-8000-000000000050';

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'application_submitted' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  're-finalizing an application does not record a second submission'
);

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'application_verified' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  're-finalizing an application does not record a second verification'
);

-- Submitted without evidence is a different fact: it happened, and nothing
-- about it was captured.
INSERT INTO public.applications (id, user_id, job_id, company_name, role_title, status, submitted_at, verification_evidence)
VALUES ('e1e10000-0000-4000-8000-000000000051', 'e1e10000-0000-4000-8000-000000000001',
        'e1e10000-0000-4000-8000-000000000011', 'Beta', 'Analyst', 'applied', now(), '{}'::jsonb);

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'application_submitted' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  2,
  'an unverified submission is still recorded as submitted'
);

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'application_verified' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  'an unverified submission is not recorded as verified'
);

-- An application that has not been submitted records nothing at all.
INSERT INTO public.applications (id, user_id, job_id, company_name, role_title, status, verification_evidence)
VALUES ('e1e10000-0000-4000-8000-000000000052', 'e1e10000-0000-4000-8000-000000000001',
        'e1e10000-0000-4000-8000-000000000011', 'Beta', 'Analyst', 'approved', '{}'::jsonb);

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'application_submitted' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  2,
  'an application that was never submitted is not recorded as submitted'
);

-- ---------------------------------------------------------------------------
-- 6. Wallet
-- ---------------------------------------------------------------------------

INSERT INTO public.credit_transactions (id, user_id, credit_type, delta, amount_cents, reason)
VALUES ('e1e10000-0000-4000-8000-000000000060', 'e1e10000-0000-4000-8000-000000000001',
        'wallet_topup', 2000, 2000, 'topup');

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'wallet_topped_up' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  'a top-up is recorded'
);

INSERT INTO public.credit_transactions (id, user_id, credit_type, delta, amount_cents, reason)
VALUES ('e1e10000-0000-4000-8000-000000000061', 'e1e10000-0000-4000-8000-000000000001',
        'smart_apply', -199, 199, 'smart apply charge');

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'wallet_charged' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  'a smart apply charge is recorded'
);

-- A refund is a positive apply transaction. Reporting it as a charge would be a
-- lie, so the sign decides and not the credit type.
INSERT INTO public.credit_transactions (id, user_id, credit_type, delta, amount_cents, reason)
VALUES ('e1e10000-0000-4000-8000-000000000062', 'e1e10000-0000-4000-8000-000000000001',
        'standard_apply', 49, 49, 'refund');

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'wallet_charged' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  'a refund is not reported as a charge'
);

-- An operator correction is a movement the candidate did not make and cannot
-- explain. It belongs in the admin audit log, not in their feed.
INSERT INTO public.credit_transactions (id, user_id, credit_type, delta, amount_cents, reason)
VALUES ('e1e10000-0000-4000-8000-000000000065', 'e1e10000-0000-4000-8000-000000000001',
        'admin_adjustment', 500, 500, 'ops correction');

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND event_type IN ('wallet_charged', 'wallet_topped_up')),
  2,
  'an operator adjustment never appears in the candidate feed'
);

-- A Live pass is not a wallet balance and the dashboard reports passes
-- separately. A pass is granted first, because the ledger refuses to take one
-- the candidate does not have.
INSERT INTO public.credit_transactions (id, user_id, credit_type, delta, reason)
VALUES ('e1e10000-0000-4000-8000-000000000063', 'e1e10000-0000-4000-8000-000000000001',
        'interview', 1, 'live pass granted');
SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND event_type IN ('wallet_charged', 'wallet_topped_up')),
  2,
  'granting a Live pass is not reported as a wallet movement'
);

INSERT INTO public.credit_transactions (id, user_id, credit_type, delta, reason)
VALUES ('e1e10000-0000-4000-8000-000000000064', 'e1e10000-0000-4000-8000-000000000001',
        'interview', -1, 'live pass used');

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND event_type IN ('wallet_charged', 'wallet_topped_up')),
  2,
  'using a Live pass is not reported as a wallet charge'
);

-- ---------------------------------------------------------------------------
-- 7. Application Agent
-- ---------------------------------------------------------------------------

INSERT INTO public.application_agent_settings (user_id, mode, paused)
VALUES ('e1e10000-0000-4000-8000-000000000001', 'review', false);

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'agent_paused' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  0,
  'first-time settings creation is not a pause'
);

UPDATE public.application_agent_settings SET paused = true
 WHERE user_id = 'e1e10000-0000-4000-8000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'agent_paused' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  'pausing the agent is recorded'
);

UPDATE public.application_agent_settings SET paused = true
 WHERE user_id = 'e1e10000-0000-4000-8000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'agent_paused' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  're-saving the settings form with the same value records nothing'
);

UPDATE public.application_agent_settings SET paused = false
 WHERE user_id = 'e1e10000-0000-4000-8000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'agent_resumed' AND user_id = 'e1e10000-0000-4000-8000-000000000001'),
  1,
  'resuming the agent is recorded'
);

-- ---------------------------------------------------------------------------
-- 8. Isolation, ordering, and the recorder's failure behaviour
-- ---------------------------------------------------------------------------

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events WHERE user_id = 'e1e10000-0000-4000-8000-000000000002'),
  0,
  'one candidate''s activity never appears on another''s'
);

SELECT is(
  (SELECT bool_and(occurred_at >= prev)
    FROM (
      SELECT occurred_at, lag(occurred_at) OVER (ORDER BY occurred_at, id) AS prev
      FROM public.candidate_activity_events
    ) ordered),
  true,
  'events are ordered by the moment they happened, not by a frozen row timestamp'
);

-- The recorder must never be able to fail the transaction it is recording.
-- This is the property that lets it live inside wallet settlement and
-- application finalization.
SELECT lives_ok(
  $$select odesseus_private.record_candidate_activity(
      'e1e10000-0000-4000-8000-000000000001', 'not_a_real_event_type',
      'a title', null, 'resume', gen_random_uuid())$$,
  'a rejected event type is swallowed rather than raised'
);

SELECT is(
  (SELECT count(*)::int FROM public.candidate_activity_events
    WHERE event_type = 'not_a_real_event_type'),
  0,
  'the swallowed call wrote nothing'
);

-- ---------------------------------------------------------------------------
-- 9. Dashboard counts
-- ---------------------------------------------------------------------------
-- Counts are exact over every row, not over a sample, and exclude closed and
-- rejected postings so the number tracks a search rather than a history.

SELECT is(
  (select jobs_discovered::int from public.odesseus_get_candidate_dashboard_counts(
     'e1e10000-0000-4000-8000-000000000001', 85)),
  (select count(*)::int from public.job_opportunities
    where user_id = 'e1e10000-0000-4000-8000-000000000001'
      and status not in ('closed', 'rejected')),
  'jobs discovered is counted over every row, not a capped fetch'
);

INSERT INTO public.job_opportunities (id, user_id, company_name, role_title, match_score, status)
VALUES ('e1e10000-0000-4000-8000-000000000012', 'e1e10000-0000-4000-8000-000000000001', 'Gamma', 'Lead', 40, 'closed');

SELECT is(
  (select jobs_discovered::int from public.odesseus_get_candidate_dashboard_counts(
     'e1e10000-0000-4000-8000-000000000001', 85)),
  2,
  'a closed posting is not counted as discovered'
);

SELECT is(
  (select jobs_strong_matches::int from public.odesseus_get_candidate_dashboard_counts(
     'e1e10000-0000-4000-8000-000000000001', 85)),
  1,
  'only jobs at or above the threshold are strong matches'
);

-- A middling open job, so the threshold has something to bite on. The closed
-- posting above cannot serve this purpose: it is excluded from the search
-- entirely, which is the point of excluding it.
INSERT INTO public.job_opportunities (id, user_id, company_name, role_title, match_score, status)
VALUES ('e1e10000-0000-4000-8000-000000000014', 'e1e10000-0000-4000-8000-000000000001', 'Delta', 'Designer', 50, 'discovered');

SELECT is(
  (select jobs_strong_matches::int from public.odesseus_get_candidate_dashboard_counts(
     'e1e10000-0000-4000-8000-000000000001', 30)),
  2,
  'the threshold is the candidate''s own setting, not a constant'
);

SELECT is(
  (select jobs_strong_matches::int from public.odesseus_get_candidate_dashboard_counts(
     'e1e10000-0000-4000-8000-000000000001', -5)),
  2,
  'a negative threshold is clamped to zero rather than trusted'
);

SELECT is(
  (select jobs_strong_matches::int from public.odesseus_get_candidate_dashboard_counts(
     'e1e10000-0000-4000-8000-000000000001', 0)),
  2,
  'a job with no score is never a strong match, even at a threshold of zero'
);

SELECT is(
  (select jobs_discovered::int from public.odesseus_get_candidate_dashboard_counts(
     'e1e10000-0000-4000-8000-000000000001', 85)),
  3,
  'discovered still excludes the closed posting after more jobs arrive'
);

-- The second candidate has rows now, so a leak would be visible.
INSERT INTO public.job_opportunities (id, user_id, company_name, role_title, match_score, status)
VALUES ('e1e10000-0000-4000-8000-000000000013', 'e1e10000-0000-4000-8000-000000000002', 'Other Co', 'Other Role', 99, 'discovered');

SELECT is(
  (select jobs_discovered::int from public.odesseus_get_candidate_dashboard_counts(
     'e1e10000-0000-4000-8000-000000000001', 85)),
  3,
  'another candidate''s jobs are never counted'
);

SELECT is(
  (select jobs_discovered::int from public.odesseus_get_candidate_dashboard_counts(
     'e1e10000-0000-4000-8000-000000000002', 85)),
  1,
  'each candidate sees only their own totals'
);

-- Ownership is enforced by the function, not trusted from the route.
SELECT throws_ok(
  $$select set_config('request.jwt.claims',
       '{"sub":"e1e10000-0000-4000-8000-000000000002","role":"authenticated"}', true);
     select public.odesseus_get_candidate_dashboard_counts(
       'e1e10000-0000-4000-8000-000000000001', 85)$$,
  '42501',
  'Not permitted',
  'an authenticated caller cannot read another candidate counts, so a bug in the route cannot become a cross-tenant read'
);

SELECT throws_ok(
  $$select public.odesseus_get_candidate_dashboard_counts(null, 85)$$,
  '22023',
  'A user id is required',
  'a null user id is rejected rather than returning every candidates rows'
);

-- A candidate who has done nothing gets zeros, not nulls and not an error.
SELECT is(
  (select queue_total::int from public.odesseus_get_candidate_dashboard_counts(
     'e1e10000-0000-4000-8000-000000000099', 85)),
  0,
  'a candidate with no activity reports zero, not null'
);

SELECT is(
  (select has_primary_resume from public.odesseus_get_candidate_dashboard_counts(
     'e1e10000-0000-4000-8000-000000000099', 85)),
  false,
  'a candidate with no resume has no primary resume'
);

-- ---------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------

SELECT ok(
  not has_function_privilege('anon', 'public.odesseus_get_candidate_dashboard_counts(uuid, integer)', 'EXECUTE'),
  'the counts function is not executable by anon'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.odesseus_get_candidate_dashboard_counts(uuid, integer)', 'EXECUTE'),
  'an authenticated candidate may read their own counts'
);

SELECT ok(
  not has_table_privilege('anon', 'public.candidate_activity_events', 'SELECT'),
  'anon cannot read any activity history'
);

SELECT ok(
  not has_table_privilege('authenticated', 'public.candidate_activity_events', 'INSERT'),
  'a candidate cannot forge their own activity, including a wallet top-up'
);

SELECT ok(
  not has_table_privilege('authenticated', 'public.candidate_activity_events', 'DELETE'),
  'a candidate cannot delete their own activity'
);

ROLLBACK;
