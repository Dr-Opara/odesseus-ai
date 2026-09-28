-- Finalization snapshot completeness + hardened charge gate (Phase 2H/2I)
-- (pgTAP). Run with: npx supabase test db
--
-- odesseus_finalize_application is the single point where a submission becomes
-- a historical record *and* where money moves. These tests cover the facts it
-- pins at that instant, and the two places it has to fail closed:
--
--   * the complete snapshot chain — source resume, tailoring, tailoring
--     version, authorising agent decision, content hash, verification
--     evidence — so a later resume edit, re-tailor, or run retry cannot
--     change what actually went to the employer;
--   * a malformed applicant-influenced tailoring_id must not abort the
--     settlement (that would lose the charge record *and* the application);
--   * a decision the agent never used to authorise a submission (RULE_MISMATCH
--     and friends) must never be recorded as the one that did.
--
-- Idempotency, atomicity, and the money amounts are covered separately by
-- apply-finalization-wallet.test.sql; run_id / execution_mode / answers by
-- application-snapshot-extensions.test.sql.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(27);

SELECT lives_ok($$INSERT INTO auth.users (id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES ('eeeeeeee-7777-4777-8777-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'snap2-u1@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create user');

SELECT lives_ok($$INSERT INTO public.job_opportunities (id, user_id, company_name, role_title)
  VALUES ('eeeeeeee-8888-4888-8888-000000000001', 'eeeeeeee-7777-4777-8777-000000000001', 'SnapCo', 'Engineer')$$,
  'create job');

-- The candidate's original uploaded resume.
SELECT lives_ok($$INSERT INTO public.resumes (id, user_id, file_name, is_approved, is_master, content_hash, size_bytes, mime_type)
  VALUES ('eeeeeeee-9999-4999-8999-000000000001', 'eeeeeeee-7777-4777-8777-000000000001',
    'source_resume.pdf', true, true,
    'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3', 204800, 'application/pdf')$$,
  'create the source resume with a content hash');

-- The optimized resume the candidate approved. Its parsed_data deliberately
-- carries a *malformed* tailoring_id: applicant-controlled JSON must never be
-- able to abort a settlement.
SELECT lives_ok($$INSERT INTO public.resumes
  (id, user_id, file_name, is_approved, is_master, content_hash, size_bytes, mime_type, parsed_data)
  VALUES ('eeeeeeee-9999-4999-8999-000000000002', 'eeeeeeee-7777-4777-8777-000000000001',
    'optimized_resume.pdf', true, false,
    'b94a8fe5ccb19ba61c4c0873d391e987982fbbd3', 198400, 'application/pdf',
    '{"tailoring_id": "not-a-uuid"}'::jsonb)$$,
  'create the approved optimized resume');

SELECT lives_ok($$INSERT INTO public.resume_tailorings
  (id, user_id, job_id, source_resume_id, version_number, status, approved_resume_id, approved_at)
  VALUES ('eeeeeeee-cccc-4ccc-8ccc-000000000001', 'eeeeeeee-7777-4777-8777-000000000001',
    'eeeeeeee-8888-4888-8888-000000000001', 'eeeeeeee-9999-4999-8999-000000000001',
    2, 'approved', 'eeeeeeee-9999-4999-8999-000000000002', now())$$,
  'create the approved tailoring that produced the submitted resume');

-- A decision that did NOT authorise a submission. The agent refused this job.
SELECT lives_ok($$INSERT INTO public.application_agent_decisions
  (id, user_id, job_id, resume_id, mode, apply_method, decision, match_score, reasons)
  VALUES ('eeeeeeee-dddd-4ddd-8ddd-000000000001', 'eeeeeeee-7777-4777-8777-000000000001',
    'eeeeeeee-8888-4888-8888-000000000001', 'eeeeeeee-9999-4999-8999-000000000002',
    'auto', 'smart_apply', 'RULE_MISMATCH', 41, '{clearance_required}')$$,
  'log a RULE_MISMATCH decision for the job');

-- The decision that did authorise it.
SELECT lives_ok($$INSERT INTO public.application_agent_decisions
  (id, user_id, job_id, resume_id, mode, apply_method, decision, match_score, reasons)
  VALUES ('eeeeeeee-dddd-4ddd-8ddd-000000000002', 'eeeeeeee-7777-4777-8777-000000000001',
    'eeeeeeee-8888-4888-8888-000000000001', 'eeeeeeee-9999-4999-8999-000000000002',
    'auto', 'smart_apply', 'AUTO_APPLY', 93, '{within_rules}')$$,
  'log the AUTO_APPLY decision for the job');

-- The run is paused on a CAPTCHA; the candidate resolves it in the live
-- browser and resumes, so the run is still in needs_user at settlement time.
SELECT lives_ok($$INSERT INTO public.application_runs
  (id, user_id, job_id, approved_resume_id, target_url, execution_mode, status,
   stop_reason, hold_category)
  VALUES ('eeeeeeee-aaaa-4aaa-8aaa-000000000001', 'eeeeeeee-7777-4777-8777-000000000001',
    'eeeeeeee-8888-4888-8888-000000000001', 'eeeeeeee-9999-4999-8999-000000000002',
    'https://snap.example.com/apply', 'smart', 'needs_user',
    'CAPTCHA or human-verification step detected.', 'captcha_required')$$,
  'create a run paused on a CAPTCHA');

SELECT lives_ok(
  $$INSERT INTO public.credit_transactions
    (user_id, credit_type, delta, reason, amount_cents, external_reference)
    VALUES ('eeeeeeee-7777-4777-8777-000000000001',
      'wallet_topup', 1000, 'fixture topup', 1000, 'snap2:topup')$$,
  'fund wallet');

-- ---------------------------------------------------------------------------
-- Settlement from a paused run.
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$SELECT public.odesseus_finalize_application(
     'eeeeeeee-aaaa-4aaa-8aaa-000000000001', 'eeeeeeee-7777-4777-8777-000000000001',
     'smart', 'Application received', 'https://snap.example.com/thanks')$$,
  'finalize a run the candidate resolved after a CAPTCHA pause');

SELECT is(
  (SELECT jsonb_build_object(
     'source_resume_id', source_resume_id,
     'tailoring_id', tailoring_id,
     'tailoring_version', tailoring_version)
   FROM public.applications
   WHERE user_id = 'eeeeeeee-7777-4777-8777-000000000001'),
  jsonb_build_object(
    'source_resume_id', 'eeeeeeee-9999-4999-8999-000000000001',
    'tailoring_id', 'eeeeeeee-cccc-4ccc-8ccc-000000000001',
    'tailoring_version', 2),
  'the application records which resume the submission started from and which tailoring version went out'
);

SELECT is(
  (SELECT agent_decision_id FROM public.applications
    WHERE user_id = 'eeeeeeee-7777-4777-8777-000000000001'),
  'eeeeeeee-dddd-4ddd-8ddd-000000000002'::uuid,
  'the authorising agent decision is pinned, and it is the AUTO_APPLY one rather than the newer-must-not-win RULE_MISMATCH'
);

SELECT is(
  (SELECT jsonb_build_object(
     'content_hash', resume_snapshot ->> 'content_hash',
     'size_bytes', resume_snapshot ->> 'size_bytes',
     'is_master', resume_snapshot ->> 'is_master',
     'external_id', job_snapshot ->> 'external_id')
   FROM public.applications
   WHERE user_id = 'eeeeeeee-7777-4777-8777-000000000001'),
  jsonb_build_object(
    'content_hash', 'b94a8fe5ccb19ba61c4c0873d391e987982fbbd3',
    'size_bytes', '198400',
    'is_master', 'false',
    'external_id', NULL),
  'the frozen resume snapshot carries the bytes hash, and the frozen job snapshot carries the employer external id'
);

SELECT is(
  (SELECT verification_evidence ->> 'execution_mode' FROM public.applications
    WHERE user_id = 'eeeeeeee-7777-4777-8777-000000000001'),
  'smart'::text,
  'the verification evidence is copied onto the immutable application row'
);

SELECT is(
  (SELECT verification_evidence ->> 'confirmation_detected' FROM public.applications
    WHERE user_id = 'eeeeeeee-7777-4777-8777-000000000001'),
  'true'::text,
  'the evidence records that a success confirmation was actually detected'
);

-- A malformed tailoring_id in the applicant-controlled resume payload is
-- ignored, not fatal: settlement completes and the charge is recorded.
SELECT is(
  (SELECT count(*) FROM public.credit_transactions
    WHERE external_reference = 'application:eeeeeeee-aaaa-4aaa-8aaa-000000000001'),
  1::bigint,
  'a malformed tailoring_id in parsed_data does not abort settlement or lose the charge'
);

SELECT is(
  (SELECT status FROM public.application_runs
    WHERE id = 'eeeeeeee-aaaa-4aaa-8aaa-000000000001'),
  'submitted'::text,
  'the run is submitted after a verified successful submission'
);

SELECT is(
  (SELECT hold_category FROM public.application_runs
    WHERE id = 'eeeeeeee-aaaa-4aaa-8aaa-000000000001'),
  NULL::text,
  'the CAPTCHA hold category is cleared once the run is no longer paused'
);

-- ---------------------------------------------------------------------------
-- The snapshot is not mutable afterwards: a later resume edit, a re-tailor, or
-- a new agent decision must not rewrite what already went to the employer.
-- ---------------------------------------------------------------------------

SELECT lives_ok($$UPDATE public.resumes
  SET content_hash = 'ffffffffffffffffffffffffffffffffffffffff'
  WHERE id = 'eeeeeeee-9999-4999-8999-000000000002'$$,
  'the resume file is later re-uploaded with different bytes');

SELECT is(
  (SELECT resume_snapshot ->> 'content_hash' FROM public.applications
    WHERE user_id = 'eeeeeeee-7777-4777-8777-000000000001'),
  'b94a8fe5ccb19ba61c4c0873d391e987982fbbd3'::text,
  'the historical application still points at the bytes that were actually submitted'
);

SELECT lives_ok($$UPDATE public.job_opportunities
  SET company_name = 'SnapCo International', role_title = 'Staff Engineer'
  WHERE id = 'eeeeeeee-8888-4888-8888-000000000001'$$,
  'the job is later edited');

SELECT is(
  (SELECT jsonb_build_object('company', company_name, 'role', role_title)
   FROM public.applications
    WHERE user_id = 'eeeeeeee-7777-4777-8777-000000000001'),
  jsonb_build_object('company', 'SnapCo', 'role', 'Engineer'),
  'the historical application still names the role that was applied to'
);

SELECT is(
  (SELECT job_snapshot ->> 'company_name' FROM public.applications
    WHERE user_id = 'eeeeeeee-7777-4777-8777-000000000001'),
  'SnapCo'::text,
  'the frozen job snapshot is not rewritten by a later job edit'
);

SELECT lives_ok($$INSERT INTO public.application_agent_decisions
  (id, user_id, job_id, resume_id, mode, apply_method, decision, match_score, reasons)
  VALUES ('eeeeeeee-dddd-4ddd-8ddd-000000000003', 'eeeeeeee-7777-4777-8777-000000000001',
    'eeeeeeee-8888-4888-8888-000000000001', 'eeeeeeee-9999-4999-8999-000000000002',
    'auto', 'smart_apply', 'DAILY_LIMIT_REACHED', 93, '{limit}')$$,
  'a later agent decision is logged for the same job');

SELECT is(
  (SELECT agent_decision_id FROM public.applications
    WHERE user_id = 'eeeeeeee-7777-4777-8777-000000000001'),
  'eeeeeeee-dddd-4ddd-8ddd-000000000002'::uuid,
  'a later agent decision does not re-point the historical application at itself'
);

-- Replaying the same finalization is still a no-charge short-circuit.
SELECT is(
  (SELECT already_finalized FROM public.odesseus_finalize_application(
     'eeeeeeee-aaaa-4aaa-8aaa-000000000001', 'eeeeeeee-7777-4777-8777-000000000001',
     'smart', 'Application received', 'https://snap.example.com/thanks')),
  true,
  'replaying the same run reports already_finalized'
);

SELECT is(
  (SELECT count(*) FROM public.credit_transactions
    WHERE external_reference = 'application:eeeeeeee-aaaa-4aaa-8aaa-000000000001'),
  1::bigint,
  'a replay never produces a second debit'
);

SELECT * FROM finish();
ROLLBACK;
