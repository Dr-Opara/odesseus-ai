-- Notification backend (Phase 2K) pgTAP.
-- Run with: npx supabase test db
--
-- Claims under test:
--
--   1. The vocabulary is closed and shared with src/lib/notifications/catalog.ts
--      (that tie is additionally asserted by a vitest migration contract test).
--   2. Preferences gate what is RECORDED: a channel that is off suppresses the
--      row at the source; a small critical set bypasses the gate; marketing
--      (product) is off by default.
--   3. The recorder deduplicates on (recipient_user_id, dedupe_key) and never
--      raises -- it lives inside wallet settlement and finalization.
--   4. Wire-ups emit exactly one row per logical transition: strong match on
--      first threshold crossing, application run holds (including a status that
--      does not change), submitted/verified once per application, wallet
--      top-up/charge once per transaction, low balance on downward crossing
--      only, employer new-applicant to members + owner, capacity warning/reached
--      on the transition into the boundary.
--   5. Interview reminders are materialized per (interview, window) in the
--      interview's timezone, never for mock interviews, and reconciled on
--      cancel/reschedule without resurrecting an already-fired reminder.
--   6. RLS: a recipient sees and can mark read only their own rows; employer
--      rows additionally require org membership.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(80);

-- Two candidates, two employer orgs. User 001 owns org1 (and is not in its
-- employer_members list -- the employer notifier must still reach the owner),
-- user 002 is a recruiter member of org1 and owner of org2. Every claim about
-- one candidate/org is only meaningful with the other's rows present.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES
  ('e1e10000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notif-a@example.test', 'x', now(), now(), now()),
  ('e1e10000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notif-b@example.test', 'x', now(), now(), now());

INSERT INTO public.employer_organizations (id, name, owner_user_id)
VALUES
  ('e1e20000-0000-4000-8000-000000000001', 'Org One', 'e1e10000-0000-4000-8000-000000000001'),
  ('e1e20000-0000-4000-8000-000000000002', 'Org Two', 'e1e10000-0000-4000-8000-000000000002');

INSERT INTO public.employer_members (org_id, user_id, role)
VALUES
  ('e1e20000-0000-4000-8000-000000000001', 'e1e10000-0000-4000-8000-000000000002', 'recruiter');

INSERT INTO public.employer_subscriptions (org_id, tier, status, job_posts_included)
VALUES
  ('e1e20000-0000-4000-8000-000000000001', 'growth', 'active', 6),
  ('e1e20000-0000-4000-8000-000000000002', 'starter', 'active', 1);

-- Publishing claims a real credit, so grant the grant rows the publish trigger
-- will consume (6 for org1: the Engineer posting plus the five capacity roles;
-- 1 for org2). It also keeps job_posts_included (6 = Engineer + A..E) aligned
-- with the capacity assertions below.
INSERT INTO public.employer_job_post_credits (org_id, total, used)
VALUES
  ('e1e20000-0000-4000-8000-000000000001', 6, 0),
  ('e1e20000-0000-4000-8000-000000000002', 1, 0);

-- Candidate 001 opts out of applications and matches; 002 uses a custom
-- strong-match threshold. Everything else stays at the documented defaults.
INSERT INTO public.notification_preferences (user_id, applications, matches)
VALUES ('e1e10000-0000-4000-8000-000000000001', false, false);

INSERT INTO public.job_preferences (user_id, min_match_score)
VALUES ('e1e10000-0000-4000-8000-000000000002', 70);

INSERT INTO public.resumes (id, user_id, file_name, is_master)
VALUES ('e1e10000-0000-4000-8000-000000000020', 'e1e10000-0000-4000-8000-000000000001', 'cv.pdf', true);

-- ---------------------------------------------------------------------------
-- 1. Vocabulary
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM pg_constraint
    WHERE conname = 'notifications_notification_type_check'),
  1,
  'the notification_type domain is enforced by a single CHECK constraint'
);

SELECT throws_ok(
  $$insert into public.notifications
      (recipient_user_id, recipient_type, notification_type, title, entity_type, entity_id)
    values ('e1e10000-0000-4000-8000-000000000001', 'candidate', 'email_detected', 'x', 'application', gen_random_uuid())$$,
  '23514',
  'new row for relation "notifications" violates check constraint "notifications_notification_type_check"',
  'the type vocabulary is closed, so an integration-derived type cannot be smuggled in'
);

SELECT throws_ok(
  $$insert into public.notifications
      (recipient_user_id, recipient_type, notification_type, title, entity_type, entity_id)
    values ('e1e10000-0000-4000-8000-000000000001', 'candidate', 'APPLICATION_SUBMITTED', 'x', 'resume', gen_random_uuid())$$,
  '23514',
  'new row for relation "notifications" violates check constraint "notifications_entity_type_check"',
  'the entity type vocabulary is closed'
);

SELECT throws_ok(
  $$insert into public.notifications
      (recipient_user_id, recipient_type, notification_type, title, entity_type, entity_id)
    values ('e1e10000-0000-4000-8000-000000000001', 'superadmin', 'APPLICATION_SUBMITTED', 'x', 'application', gen_random_uuid())$$,
  '23514',
  'new row for relation "notifications" violates check constraint "notifications_recipient_type_check"',
  'there is no third recipient kind'
);

SELECT throws_ok(
  $$insert into public.notifications
      (recipient_user_id, recipient_type, notification_type, title, entity_type, entity_id)
    values ('e1e10000-0000-4000-8000-000000000001', 'candidate', 'APPLICATION_SUBMITTED', '   ', 'application', gen_random_uuid())$$,
  '23514',
  'new row for relation "notifications" violates check constraint "notifications_title_check"',
  'a blank notification is a blank line'
);

-- ---------------------------------------------------------------------------
-- 2. Preference defaults and recording gates
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.notification_preferences
    WHERE user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND email AND interview_reminders AND wallet_billing),
  1,
  'the new candidate channels default on: email, interview_reminders, wallet_billing'
);

-- The critical set bypasses the channel gate: 001 opted out of applications,
-- but a CAPTCHA block loses the application, so it still records.
SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND notification_type = 'APPLICATION_CAPTCHA_REQUIRED'),
  0,
  'setup: no CAPTCHA rows yet'
);

SELECT lives_ok(
  $$select odesseus_private.record_notification(
      'e1e10000-0000-4000-8000-000000000001', 'candidate', null,
      'APPLICATION_CAPTCHA_REQUIRED', 'CAPTCHA test', null, 'application_run',
      gen_random_uuid(), null, 'urgent', 'gate:captcha:critical', '{}'::jsonb)$$,
  'record_notification never raises on gated input'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND notification_type = 'APPLICATION_CAPTCHA_REQUIRED'),
  1,
  'a critical CAPTCHA block is recorded even though applications is off'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND notification_type = 'JOB_STRONG_MATCH'),
  0,
  'matches off suppresses a strong-match row at the source'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND notification_type = 'PRODUCT_UPDATE'),
  0,
  'product updates are off by default: marketing never records unprompted'
);

UPDATE public.notification_preferences SET product = true
 WHERE user_id = 'e1e10000-0000-4000-8000-000000000001';

SELECT lives_ok(
  $$select odesseus_private.record_notification(
      'e1e10000-0000-4000-8000-000000000001', 'candidate', null,
      'PRODUCT_UPDATE', 'New feature', null, 'account', gen_random_uuid(),
      null, 'normal', 'gate:product:1', '{}'::jsonb)$$,
  'a product update record lives once opted in'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND notification_type = 'PRODUCT_UPDATE'),
  1,
  'product updates record when the product channel is on'
);

-- Employer gate is org-scoped. billing off suppresses, on records.
SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE organization_id = 'e1e20000-0000-4000-8000-000000000001'
      AND notification_type = 'EMPLOYER_SUBSCRIPTION_EVENT'),
  0,
  'setup: no employer subscription rows yet'
);

INSERT INTO public.employer_notification_preferences (org_id, billing)
VALUES ('e1e20000-0000-4000-8000-000000000001', false);

SELECT lives_ok(
  $$select odesseus_private.record_notification(
      'e1e10000-0000-4000-8000-000000000002', 'employer_member',
      'e1e20000-0000-4000-8000-000000000001',
      'EMPLOYER_SUBSCRIPTION_EVENT', 'plan updated', null, 'employer_organization',
      'e1e20000-0000-4000-8000-000000000001', null, 'normal', 'gate:employer:1', '{}'::jsonb)$$,
  'an employer-gated record lives even when the gate is closed'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE organization_id = 'e1e20000-0000-4000-8000-000000000001'
      AND notification_type = 'EMPLOYER_SUBSCRIPTION_EVENT'),
  0,
  'billing off suppresses the employer subscription row for the whole org'
);

UPDATE public.employer_notification_preferences SET billing = true
 WHERE org_id = 'e1e20000-0000-4000-8000-000000000001';

SELECT lives_ok(
  $$select odesseus_private.record_notification(
      'e1e10000-0000-4000-8000-000000000002', 'employer_member',
      'e1e20000-0000-4000-8000-000000000001',
      'EMPLOYER_SUBSCRIPTION_EVENT', 'plan updated', null, 'employer_organization',
      'e1e20000-0000-4000-8000-000000000001', null, 'normal', 'gate:employer:2', '{}'::jsonb)$$,
  'an employer-gated record lives once billing is on'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE organization_id = 'e1e20000-0000-4000-8000-000000000001'
      AND notification_type = 'EMPLOYER_SUBSCRIPTION_EVENT'),
  1,
  'billing on records the employer subscription row'
);

-- ---------------------------------------------------------------------------
-- 3. Strong match: first threshold crossing, once per job
-- ---------------------------------------------------------------------------
INSERT INTO public.job_opportunities (id, user_id, company_name, role_title, match_score, status)
VALUES ('e1e10000-0000-4000-8000-000000000010', 'e1e10000-0000-4000-8000-000000000001', 'Acme', 'Engineer', 80, 'discovered');

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND notification_type = 'JOB_STRONG_MATCH'),
  0,
  'a score below the default threshold is not a strong match'
);

-- matches is off for 001, so even the threshold crossing is suppressed at the
-- source; the trigger fired, the gate said no. This section needs a candidate
-- with matches on, so the remaining assertions use 002.
UPDATE public.job_opportunities SET match_score = 92
 WHERE id = 'e1e10000-0000-4000-8000-000000000010';

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND notification_type = 'JOB_STRONG_MATCH'),
  0,
  'matches off suppresses the crossing too -- the trigger emitted nothing visible'
);

INSERT INTO public.job_opportunities (id, user_id, company_name, role_title, match_score, status)
VALUES ('e1e10000-0000-4000-8000-000000000011', 'e1e10000-0000-4000-8000-000000000002', 'Beta', 'Analyst', 60, 'discovered');

UPDATE public.job_opportunities SET match_score = 75
 WHERE id = 'e1e10000-0000-4000-8000-000000000011';

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000002'
      AND notification_type = 'JOB_STRONG_MATCH'),
  1,
  'a first crossing of the candidate''s own threshold (70) records one match'
);

UPDATE public.job_opportunities SET match_score = 88
 WHERE id = 'e1e10000-0000-4000-8000-000000000011';

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000002'
      AND notification_type = 'JOB_STRONG_MATCH'),
  1,
  're-scoring an already-strong job is not a new match'
);

-- ---------------------------------------------------------------------------
-- 4. Application runs
-- ---------------------------------------------------------------------------
INSERT INTO public.application_runs (id, user_id, job_id, approved_resume_id, target_url, execution_mode, status)
VALUES ('e1e10000-0000-4000-8000-000000000040', 'e1e10000-0000-4000-8000-000000000001',
        'e1e10000-0000-4000-8000-000000000010', 'e1e10000-0000-4000-8000-000000000020',
        'https://acme.test/apply', 'standard', 'queued');

UPDATE public.application_runs SET status = 'ready_to_submit'
 WHERE id = 'e1e10000-0000-4000-8000-000000000040';

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND notification_type = 'APPLICATION_NEEDS_REVIEW'),
  0,
  '001 opted out of applications, so the ready-to-review row is suppressed'
);

-- Run for 002 (applications left on) so the hold lifecycle can be observed.
INSERT INTO public.application_runs (id, user_id, job_id, approved_resume_id, target_url, execution_mode, status)
VALUES ('e1e10000-0000-4000-8000-000000000041', 'e1e10000-0000-4000-8000-000000000002',
        'e1e10000-0000-4000-8000-000000000011', 'e1e10000-0000-4000-8000-000000000020',
        'https://beta.test/apply', 'standard', 'queued');

UPDATE public.application_runs SET status = 'ready_to_submit'
 WHERE id = 'e1e10000-0000-4000-8000-000000000041';

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000002'
      AND notification_type = 'APPLICATION_NEEDS_REVIEW'),
  1,
  'a run ready to send records one needs-review'
);

UPDATE public.application_runs SET status = 'ready_to_submit'
 WHERE id = 'e1e10000-0000-4000-8000-000000000041';

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000002'
      AND notification_type = 'APPLICATION_NEEDS_REVIEW'),
  1,
  're-asserting ready_to_submit records nothing'
);

UPDATE public.application_runs SET status = 'needs_user', hold_category = 'captcha_required', stop_reason = 'CAPTCHA_REQUIRED'
 WHERE id = 'e1e10000-0000-4000-8000-000000000041';

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000002'
      AND notification_type = 'APPLICATION_CAPTCHA_REQUIRED'),
  1,
  'a CAPTCHA hold records an urgent captcha block'
);

UPDATE public.application_runs SET hold_category = 'captcha_required', stop_reason = 'CAPTCHA_REQUIRED'
 WHERE id = 'e1e10000-0000-4000-8000-000000000041';

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000002'
      AND notification_type = 'APPLICATION_CAPTCHA_REQUIRED'),
  1,
  're-asserting the same hold records nothing'
);

UPDATE public.application_runs SET hold_category = 'mfa_required', stop_reason = 'MFA_REQUIRED'
 WHERE id = 'e1e10000-0000-4000-8000-000000000041';

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000002'
      AND notification_type = 'APPLICATION_MFA_REQUIRED'),
  1,
  'an MFA hold records an mfa block'
);

UPDATE public.application_runs SET hold_category = 'sensitive_question', stop_reason = 'SENSITIVE'
 WHERE id = 'e1e10000-0000-4000-8000-000000000041';

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000002'
      AND notification_type = 'APPLICATION_SENSITIVE_QUESTION'),
  1,
  'a sensitive-question hold records a sensitive block'
);

UPDATE public.application_runs SET hold_category = 'insufficient_funds', stop_reason = 'LOW_FUNDS'
 WHERE id = 'e1e10000-0000-4000-8000-000000000041';

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000002'
      AND notification_type = 'APPLICATION_MANUAL_ACTION_REQUIRED'),
  1,
  'an insufficient-funds hold records a manual-action block'
);

UPDATE public.application_runs SET status = 'needs_user', hold_category = 'needs_review', stop_reason = null
 WHERE id = 'e1e10000-0000-4000-8000-000000000040';

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND notification_type = 'APPLICATION_NEEDS_INPUT'),
  0,
  '001 opted out of applications, so a decision stop is suppressed too'
);

UPDATE public.application_runs SET status = 'needs_user', hold_category = 'needs_review', stop_reason = null
 WHERE id = 'e1e10000-0000-4000-8000-000000000041';

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000002'
      AND notification_type = 'APPLICATION_NEEDS_INPUT'),
  1,
  'a run stopped for a decision records needs-input'
);

UPDATE public.application_runs SET status = 'failed', stop_reason = 'NETWORK'
 WHERE id = 'e1e10000-0000-4000-8000-000000000041';

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000002'
      AND notification_type = 'APPLICATION_FAILED'),
  1,
  'a failed run records the failure'
);

-- ---------------------------------------------------------------------------
-- 5. Applications: submitted / verified
-- ---------------------------------------------------------------------------
INSERT INTO public.applications (id, user_id, job_id, company_name, role_title, status, submitted_at, verification_evidence)
VALUES ('e1e10000-0000-4000-8000-000000000050', 'e1e10000-0000-4000-8000-000000000002',
        'e1e10000-0000-4000-8000-000000000011', 'Beta', 'Analyst', 'applied', now(), '{"confirmation": "abc"}'::jsonb);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000002'
      AND notification_type = 'APPLICATION_SUBMITTED'),
  1,
  'a verified submitted application records submitted once'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000002'
      AND notification_type = 'APPLICATION_VERIFIED'),
  1,
  'a submission carrying evidence records verified once'
);

UPDATE public.applications SET submitted_at = now(), verification_evidence = '{"confirmation": "abc"}'::jsonb
 WHERE id = 'e1e10000-0000-4000-8000-000000000050';

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000002'
      AND notification_type = 'APPLICATION_SUBMITTED'),
  1,
  're-finalizing an application does not record a second submission'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000002'
      AND notification_type = 'APPLICATION_VERIFIED'),
  1,
  're-finalizing an application does not record a second verification'
);

INSERT INTO public.applications (id, user_id, job_id, company_name, role_title, status, submitted_at, verification_evidence)
VALUES ('e1e10000-0000-4000-8000-000000000051', 'e1e10000-0000-4000-8000-000000000002',
        'e1e10000-0000-4000-8000-000000000011', 'Beta', 'Analyst', 'applied', now(), '{}'::jsonb);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000002'
      AND notification_type = 'APPLICATION_SUBMITTED'),
  2,
  'an unverified submission is still recorded as submitted'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000002'
      AND notification_type = 'APPLICATION_VERIFIED'),
  1,
  'an unverified submission is not recorded as verified'
);

INSERT INTO public.applications (id, user_id, job_id, company_name, role_title, status)
VALUES ('e1e10000-0000-4000-8000-000000000052', 'e1e10000-0000-4000-8000-000000000002',
        'e1e10000-0000-4000-8000-000000000011', 'Beta', 'Analyst', 'approved');

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000002'
      AND notification_type = 'APPLICATION_SUBMITTED'),
  2,
  'an application that was never submitted records nothing'
);

-- ---------------------------------------------------------------------------
-- 6. Employer new-application: members + owner, org-scoped, deduped
-- ---------------------------------------------------------------------------
INSERT INTO public.employer_jobs (id, org_id, title, status)
VALUES ('e1e30000-0000-4000-8000-000000000001', 'e1e20000-0000-4000-8000-000000000001', 'Engineer', 'published');

-- job 010 is 001's Acme role with employer attribution to org1.
UPDATE public.job_opportunities SET employer_job_id = 'e1e30000-0000-4000-8000-000000000001'
 WHERE id = 'e1e10000-0000-4000-8000-000000000010';

INSERT INTO public.applications (id, user_id, job_id, company_name, role_title, status, submitted_at, verification_evidence)
VALUES ('e1e10000-0000-4000-8000-000000000053', 'e1e10000-0000-4000-8000-000000000001',
        'e1e10000-0000-4000-8000-000000000010', 'Acme', 'Engineer', 'applied', now(), '{}'::jsonb);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE notification_type = 'EMPLOYER_NEW_APPLICANT'
      AND organization_id = 'e1e20000-0000-4000-8000-000000000001'),
  2,
  'a new application notifies the org owner and every member (2 recipients)'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE notification_type = 'EMPLOYER_NEW_APPLICANT'
      AND recipient_type = 'employer_member'
      AND organization_id = 'e1e20000-0000-4000-8000-000000000001'),
  2,
  'every employer new-applicant row is org-scoped'
);

UPDATE public.applications SET submitted_at = now()
 WHERE id = 'e1e10000-0000-4000-8000-000000000053';

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE notification_type = 'EMPLOYER_NEW_APPLICANT'
      AND organization_id = 'e1e20000-0000-4000-8000-000000000001'),
  2,
  're-finalizing the application does not re-notify the org'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE notification_type = 'EMPLOYER_NEW_APPLICANT'
      AND organization_id = 'e1e20000-0000-4000-8000-000000000002'),
  0,
  'an application targeting org1 notifies nothing at org2'
);

-- ---------------------------------------------------------------------------
-- 7. Wallet: top-ups, charges, and the low-balance crossing
-- ---------------------------------------------------------------------------
INSERT INTO public.credit_transactions (id, user_id, credit_type, delta, reason, amount_cents, balance_cents_after)
VALUES ('e1e10000-0000-4000-8000-000000000060', 'e1e10000-0000-4000-8000-000000000001', 'wallet_topup', 1000, 'topup', 1000, 1000);

INSERT INTO public.credit_transactions (id, user_id, credit_type, delta, reason, amount_cents, balance_cents_after)
VALUES ('e1e10000-0000-4000-8000-000000000061', 'e1e10000-0000-4000-8000-000000000001', 'smart_apply', -199, 'smart apply', 199, 801);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND notification_type = 'WALLET_TOPUP_SUCCEEDED'),
  1,
  'a top-up records wallet topped up'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND notification_type = 'APPLICATION_CHARGE_POSTED'),
  1,
  'a smart apply charge records the posted charge'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND notification_type = 'WALLET_LOW_BALANCE'),
  0,
  'a charge that stays above the threshold is not a low-balance event'
);

INSERT INTO public.credit_transactions (id, user_id, credit_type, delta, reason, amount_cents, balance_cents_after)
VALUES ('e1e10000-0000-4000-8000-000000000062', 'e1e10000-0000-4000-8000-000000000001', 'smart_apply', -199, 'smart apply', 199, 602);

INSERT INTO public.credit_transactions (id, user_id, credit_type, delta, reason, amount_cents, balance_cents_after)
VALUES ('e1e10000-0000-4000-8000-000000000063', 'e1e10000-0000-4000-8000-000000000001', 'smart_apply', -199, 'smart apply', 199, 403);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND notification_type = 'WALLET_LOW_BALANCE'),
  1,
  'the first charge that drops the balance below the threshold records low balance'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND notification_type = 'APPLICATION_CHARGE_POSTED'),
  3,
  'each charge posts its own row'
);

INSERT INTO public.credit_transactions (id, user_id, credit_type, delta, reason, amount_cents, balance_cents_after)
VALUES ('e1e10000-0000-4000-8000-000000000064', 'e1e10000-0000-4000-8000-000000000001', 'smart_apply', -199, 'smart apply', 199, 204);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND notification_type = 'WALLET_LOW_BALANCE'),
  1,
  'a charge taken already below the threshold is not a new crossing'
);

INSERT INTO public.credit_transactions (id, user_id, credit_type, delta, reason, amount_cents, balance_cents_after)
VALUES ('e1e10000-0000-4000-8000-000000000065', 'e1e10000-0000-4000-8000-000000000001', 'wallet_topup', 900, 'topup', 900, 1104);

INSERT INTO public.credit_transactions (id, user_id, credit_type, delta, reason, amount_cents, balance_cents_after)
VALUES ('e1e10000-0000-4000-8000-000000000066', 'e1e10000-0000-4000-8000-000000000001', 'smart_apply', -199, 'smart apply', 199, 905);

INSERT INTO public.credit_transactions (id, user_id, credit_type, delta, reason, amount_cents, balance_cents_after)
VALUES ('e1e10000-0000-4000-8000-000000000067', 'e1e10000-0000-4000-8000-000000000001', 'smart_apply', -199, 'smart apply', 199, 706);

-- 706 >= 500; no crossing happened yet despite three charges since the top-up.
SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND notification_type = 'WALLET_LOW_BALANCE'),
  1,
  'charges above the threshold keep quiet; low balance is a crossing, not a level'
);

INSERT INTO public.credit_transactions (id, user_id, credit_type, delta, reason, amount_cents, balance_cents_after)
VALUES ('e1e10000-0000-4000-8000-000000000068', 'e1e10000-0000-4000-8000-000000000001', 'smart_apply', -299, 'smart apply', 299, 407);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND notification_type = 'WALLET_LOW_BALANCE'),
  2,
  'a refilled wallet that drops below the threshold again crosses again'
);

INSERT INTO public.credit_transactions (id, user_id, credit_type, delta, reason, amount_cents, balance_cents_after)
VALUES ('e1e10000-0000-4000-8000-000000000069', 'e1e10000-0000-4000-8000-000000000001', 'standard_apply', 49, 'refund', 49, 456);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND notification_type = 'APPLICATION_CHARGE_POSTED'),
  7,
  'a refund is not reported as a charge (7 charges total, refunds add none)'
);

-- ---------------------------------------------------------------------------
-- 8. Employer capacity: warning at 1 remaining, reached at 0
-- ---------------------------------------------------------------------------
INSERT INTO public.employer_jobs (id, org_id, title, status)
VALUES
  ('e1e30000-0000-4000-8000-000000000010', 'e1e20000-0000-4000-8000-000000000001', 'Role A', 'published'),
  ('e1e30000-0000-4000-8000-000000000020', 'e1e20000-0000-4000-8000-000000000001', 'Role B', 'published'),
  ('e1e30000-0000-4000-8000-000000000030', 'e1e20000-0000-4000-8000-000000000001', 'Role C', 'published');

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE notification_type = 'EMPLOYER_JOB_CAPACITY_WARNING'
      AND organization_id = 'e1e20000-0000-4000-8000-000000000001'),
  0,
  'publishing while 4 slots still remain is not a warning'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE notification_type = 'EMPLOYER_JOB_CAPACITY_REACHED'
      AND organization_id = 'e1e20000-0000-4000-8000-000000000001'),
  0,
  'no reached event before capacity is used'
);

INSERT INTO public.employer_jobs (id, org_id, title, status)
VALUES ('e1e30000-0000-4000-8000-000000000040', 'e1e20000-0000-4000-8000-000000000001', 'Role D', 'published');

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE notification_type = 'EMPLOYER_JOB_CAPACITY_WARNING'
      AND organization_id = 'e1e20000-0000-4000-8000-000000000001'),
  2,
  'the transition into one remaining slot warns the owner and the member'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE notification_type = 'EMPLOYER_JOB_CAPACITY_REACHED'
      AND organization_id = 'e1e20000-0000-4000-8000-000000000001'),
  0,
  'one remaining slot is not yet reached'
);

UPDATE public.employer_jobs SET status = 'published'
 WHERE id = 'e1e30000-0000-4000-8000-000000000040';

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE notification_type = 'EMPLOYER_JOB_CAPACITY_WARNING'
      AND organization_id = 'e1e20000-0000-4000-8000-000000000001'),
  2,
  're-asserting the same publish does not re-warn'
);

-- Publish a fifth job (Role E) to cross into zero remaining.
UPDATE public.employer_jobs SET status = 'published'
 WHERE id = 'e1e30000-0000-4000-8000-000000000040';

INSERT INTO public.employer_jobs (id, org_id, title, status)
VALUES ('e1e30000-0000-4000-8000-000000000050', 'e1e20000-0000-4000-8000-000000000001', 'Role E', 'published');

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE notification_type = 'EMPLOYER_JOB_CAPACITY_REACHED'
      AND organization_id = 'e1e20000-0000-4000-8000-000000000001'),
  2,
  'the transition into zero remaining slots reaches the owner and the member'
);

UPDATE public.employer_jobs SET status = 'closed'
 WHERE id = 'e1e30000-0000-4000-8000-000000000050';

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE notification_type = 'EMPLOYER_JOB_CAPACITY_REACHED'
      AND organization_id = 'e1e20000-0000-4000-8000-000000000001'),
  2,
  'closing a job frees capacity and is not a reached event'
);

-- Capacity is per-org: org2 (1 included) notifies only its own owner.
INSERT INTO public.employer_jobs (id, org_id, title, status)
VALUES ('e1e30000-0000-4000-8000-000000000060', 'e1e20000-0000-4000-8000-000000000002', 'Org Two Role', 'published');

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE notification_type = 'EMPLOYER_JOB_CAPACITY_REACHED'
      AND organization_id = 'e1e20000-0000-4000-8000-000000000002'),
  1,
  'org2 capacity reached notifies only org2''s owner'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE notification_type = 'EMPLOYER_JOB_CAPACITY_REACHED'
      AND organization_id = 'e1e20000-0000-4000-8000-000000000001'),
  2,
  'org2''s capacity events never leak into org1''s count'
);

-- ---------------------------------------------------------------------------
-- 9. Interview reminders
-- ---------------------------------------------------------------------------
-- A real future interview gets both windows, anchored in its timezone.
INSERT INTO public.interviews (id, user_id, application_id, scheduled_at, timezone, status, interview_type)
VALUES ('e1e10000-0000-4000-8000-000000000070', 'e1e10000-0000-4000-8000-000000000002',
        'e1e10000-0000-4000-8000-000000000050', now() + interval '50 hours', 'America/New_York', 'scheduled', 'technical');

SELECT is(
  (SELECT count(*)::int FROM public.notification_reminders
    WHERE interview_id = 'e1e10000-0000-4000-8000-000000000070'),
  2,
  'a real future interview materializes both reminder windows'
);

SELECT is(
  (SELECT array_agg(reminder_type ORDER BY reminder_type)::text[]
    FROM public.notification_reminders
    WHERE interview_id = 'e1e10000-0000-4000-8000-000000000070'),
  ARRAY['1_day', '1_hour']::text[],
  'the two reminder windows are exactly 1_day and 1_hour'
);

SELECT is(
  (SELECT count(*)::int FROM public.notification_reminders
    WHERE interview_id = 'e1e10000-0000-4000-8000-000000000070'
      AND reminder_type = '1_day'
      AND due_at = (select scheduled_at - interval '1 day' from public.interviews where id = 'e1e10000-0000-4000-8000-000000000070')),
  1,
  'the day reminder is due exactly 24 hours before the interview'
);

SELECT is(
  (SELECT count(*)::int FROM public.notification_reminders
    WHERE interview_id = 'e1e10000-0000-4000-8000-000000000070'
      AND reminder_type = '1_hour'
      AND due_at = (select scheduled_at - interval '1 hour' from public.interviews where id = 'e1e10000-0000-4000-8000-000000000070')),
  1,
  'the hour reminder is due exactly 1 hour before the interview'
);

SELECT is(
  (SELECT count(*)::int FROM public.notification_reminders
    WHERE interview_id = 'e1e10000-0000-4000-8000-000000000070'
      AND timezone = 'America/New_York'),
  2,
  'the interview timezone travels with both reminders'
);

INSERT INTO public.interviews (id, user_id, application_id, scheduled_at, timezone, status, interview_type)
VALUES ('e1e10000-0000-4000-8000-000000000071', 'e1e10000-0000-4000-8000-000000000002',
        'e1e10000-0000-4000-8000-000000000050', now() + interval '3 days', 'UTC', 'scheduled', 'mock');

SELECT is(
  (SELECT count(*)::int FROM public.notification_reminders
    WHERE interview_id = 'e1e10000-0000-4000-8000-000000000071'),
  0,
  'a mock interview is a practice session and schedules no reminders'
);

UPDATE public.interviews SET status = 'cancelled'
 WHERE id = 'e1e10000-0000-4000-8000-000000000070';

SELECT is(
  (SELECT count(*)::int FROM public.notification_reminders
    WHERE interview_id = 'e1e10000-0000-4000-8000-000000000070' AND status = 'scheduled'),
  0,
  'cancelling the interview cancels its pending reminders'
);

UPDATE public.interviews SET status = 'scheduled', scheduled_at = now() + interval '60 hours'
 WHERE id = 'e1e10000-0000-4000-8000-000000000070';

SELECT is(
  (SELECT count(*)::int FROM public.notification_reminders
    WHERE interview_id = 'e1e10000-0000-4000-8000-000000000070' AND status = 'scheduled'),
  2,
  'a reschedule re-arms the reminder windows'
);

SELECT is(
  (SELECT count(*)::int FROM public.notification_reminders
    WHERE interview_id = 'e1e10000-0000-4000-8000-000000000070'
      AND reminder_type = '1_day'
      AND due_at = (select scheduled_at - interval '1 day' from public.interviews where id = 'e1e10000-0000-4000-8000-000000000070')),
  1,
  'after a reschedule the day reminder tracks the new time'
);

-- An already-fired reminder is never resurrected by a later reschedule: the
-- candidate already got the day reminder for that window.
UPDATE public.notification_reminders SET status = 'fired'
 WHERE interview_id = 'e1e10000-0000-4000-8000-000000000070' AND reminder_type = '1_day';

UPDATE public.interviews SET scheduled_at = now() + interval '72 hours'
 WHERE id = 'e1e10000-0000-4000-8000-000000000070';

SELECT is(
  (SELECT count(*)::int FROM public.notification_reminders
    WHERE interview_id = 'e1e10000-0000-4000-8000-000000000070' AND status = 'fired'),
  1,
  'a fired reminder stays fired across reschedules'
);

SELECT is(
  (SELECT count(*)::int FROM public.notification_reminders
    WHERE interview_id = 'e1e10000-0000-4000-8000-000000000070' AND status = 'scheduled'),
  1,
  'the not-yet-fired window re-arms on reschedule'
);

-- ---------------------------------------------------------------------------
-- 10. RLS: recipients see only their own rows; employer rows need membership
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"e1e10000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND recipient_type = 'candidate'
      AND notification_type = 'APPLICATION_CAPTCHA_REQUIRED'),
  1,
  'as 001, own critical notifications are visible'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000002'
      AND recipient_type = 'candidate'),
  0,
  'as 001, another candidate''s notifications are invisible'
);

-- 001 owns org1, so org1 employer rows are visible; org2 is someone else's.
SELECT ok(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND recipient_type = 'employer_member'
      AND organization_id = 'e1e20000-0000-4000-8000-000000000001') > 0,
  'as 001, the org1 employer feed is visible to the owner'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE organization_id = 'e1e20000-0000-4000-8000-000000000002'),
  0,
  'as 001, another org''s notifications are invisible'
);

SET ROLE postgres;
SELECT set_config('request.jwt.claims', '{"sub":"e1e10000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SET ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'),
  0,
  'as 002, every row of 001 is invisible -- candidate and org1 employer rows alike'
);

-- The one browser write allowed on notifications is marking read_at. As 002,
-- aiming that write at 001's rows matches nothing by RLS policy: the statement
-- succeeds but changes nothing. Verified from postgres (notifications start
-- with read_at null and only this write could have set it).
SELECT lives_ok(
  $$UPDATE public.notifications SET read_at = now()
     WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'$$,
  'as 002, an update aimed at 001''s rows is permitted but filtered by policy'
);

SET ROLE postgres;

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE recipient_user_id = 'e1e10000-0000-4000-8000-000000000001'
      AND read_at IS NOT NULL),
  0,
  'as 002, marking 001''s rows read changed nothing'
);

RESET ROLE;
ROLLBACK;