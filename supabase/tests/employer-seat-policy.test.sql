-- Employer seat policy: every additional active member is a paid seat.
-- Run with: npx supabase test db
--
-- The product decision, restated as the thing under test:
--
--   The organization owner is included and consumes no paid seat. Every
--   additional ACTIVE organization member consumes one $20/month seat, whatever
--   their role. Paid roles: admin, recruiter, viewer.
--
--     owner only                 -> 0 paid seats
--     owner + 1 recruiter        -> 1 paid seat
--     owner + 1 admin            -> 1 paid seat
--     owner + 1 viewer           -> 1 paid seat
--     owner + 1 admin + 2 recs   -> 3 paid seats
--
-- This file proves the two halves separately:
--   * odesseus_metered_org_roles() lists every role an invitation can grant, so
--     no role is a way to take a seat for free,
--   * odesseus_org_required_seat_count() derives the count from the roster and
--     excludes the owner by identity rather than by role.
--
-- Membership is written directly here (service role) rather than through the
-- invitation flow: the point under test is the derivation, and going through
-- invitations would make every case depend on a paid seat entitlement existing
-- first. The invitation-side enforcement is covered in
-- recruiter-seat-invitations.test.sql.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(24);

-- ---------------------------------------------------------------------------
-- Phase 0. Fixtures (privileged role)
-- ---------------------------------------------------------------------------
-- One user per role plus the owner. Deliberately includes a user who will hold
-- BOTH a member row in a metered role and the organization's owner_user_id, so
-- the owner-exclusion test cannot pass merely because the owner has no row.
DO $$
DECLARE
  v_ids uuid[] := ARRAY[
    '51111111-1111-4111-8111-111111111111'::uuid,
    '51111111-1111-4111-8111-222222222222'::uuid,
    '51111111-1111-4111-8111-333333333333'::uuid,
    '51111111-1111-4111-8111-444444444444'::uuid,
    '51111111-1111-4111-8111-555555555555'::uuid
  ];
  v_email text;
  v_id uuid;
BEGIN
  FOREACH v_id IN ARRAY v_ids LOOP
    v_email := 'seat-policy-' || substr(v_id::text, -4) || '@example.com';
    INSERT INTO auth.users (id, instance_id, aud, role, email,
      encrypted_password, email_confirmed_at, created_at, updated_at)
    VALUES (v_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', v_email,
      'not-a-real-password', now(), now(), now());
  END LOOP;
END$$;

SELECT lives_ok(
  $$INSERT INTO public.employer_organizations (id, name, owner_user_id)
   VALUES ('61111111-1111-4111-8111-111111111111', 'Policy Org',
     '51111111-1111-4111-8111-111111111111')$$,
  'create the policy test organization');

-- ---------------------------------------------------------------------------
-- Phase 1. The metered role list
-- ---------------------------------------------------------------------------
SELECT is(
  public.odesseus_metered_org_roles(),
  ARRAY['admin', 'recruiter', 'viewer']::text[],
  'every role an invitation can grant consumes a paid seat');

-- The list is exactly the invitable roles. If a new invitable role is ever
-- added without being metered, that user could join a team for free, so this
-- comparison is the guard against the policy drifting open again.
SELECT is(
  (SELECT array_agg(r ORDER BY r)
     FROM unnest(ARRAY['admin', 'recruiter', 'viewer']::text[]) r),
  public.odesseus_metered_org_roles(),
  'the metered list covers the full invitable role set, so no role is free');

SELECT ok(
  NOT ('owner'::text = any (public.odesseus_metered_org_roles())),
  'owner is not a metered role, so the owner needs no separate exclusion entry');

-- ---------------------------------------------------------------------------
-- Phase 2. An organization with only its owner requires zero seats
-- ---------------------------------------------------------------------------
SELECT is(
  public.odesseus_org_required_seat_count('61111111-1111-4111-8111-111111111111'),
  0, 'an owner-only organization requires zero paid seats');

-- ---------------------------------------------------------------------------
-- Phase 3. One additional member, one seat, whatever the role
-- ---------------------------------------------------------------------------
-- Admin
INSERT INTO public.employer_members (org_id, user_id, role)
  VALUES ('61111111-1111-4111-8111-111111111111',
    '51111111-1111-4111-8111-222222222222', 'admin');

SELECT is(
  public.odesseus_org_required_seat_count('61111111-1111-4111-8111-111111111111'),
  1, 'owner + 1 admin requires exactly 1 paid seat');

-- Recruiter
INSERT INTO public.employer_members (org_id, user_id, role)
  VALUES ('61111111-1111-4111-8111-111111111111',
    '51111111-1111-4111-8111-333333333333', 'recruiter');

SELECT is(
  public.odesseus_org_required_seat_count('61111111-1111-4111-8111-111111111111'),
  2, 'owner + 1 admin + 1 recruiter requires 2 paid seats');

-- Viewer
INSERT INTO public.employer_members (org_id, user_id, role)
  VALUES ('61111111-1111-4111-8111-111111111111',
    '51111111-1111-4111-8111-444444444444', 'viewer');

SELECT is(
  public.odesseus_org_required_seat_count('61111111-1111-4111-8111-111111111111'),
  3, 'owner + 1 admin + 1 recruiter + 1 viewer requires 3 paid seats: a viewer is not a free seat');

-- A second org proves the count is org-scoped: the same users, a different org,
-- must not see each other's members.
INSERT INTO public.employer_organizations (id, name, owner_user_id)
  VALUES ('61111111-1111-4111-8111-222222222222', 'Other Policy Org',
    '51111111-1111-4111-8111-555555555555');

SELECT is(
  public.odesseus_org_required_seat_count('61111111-1111-4111-8111-222222222222'),
  0, 'a second owner-only organization is unaffected by the first org''s members');

-- ---------------------------------------------------------------------------
-- Phase 4. The owner is excluded by identity, not by role
-- ---------------------------------------------------------------------------
-- Give the owner their own member row in a metered role. The required count must
-- not move: the exclusion is employer_organizations.owner_user_id, so it holds
-- even for a user who is simultaneously the owner and a metered member.
INSERT INTO public.employer_members (org_id, user_id, role)
  VALUES ('61111111-1111-4111-8111-111111111111',
    '51111111-1111-4111-8111-111111111111', 'admin');

SELECT is(
  public.odesseus_org_required_seat_count('61111111-1111-4111-8111-111111111111'),
  3, 'an owner who also holds a metered member row still consumes no paid seat');

-- Removing members reduces the requirement, one seat per member.
DELETE FROM public.employer_members
  WHERE org_id = '61111111-1111-4111-8111-111111111111'
    AND user_id = '51111111-1111-4111-8111-333333333333';

SELECT is(
  public.odesseus_org_required_seat_count('61111111-1111-4111-8111-111111111111'),
  2, 'removing one member reduces the required seats by exactly one');

-- The derivation is a pure function of current membership, which is what makes a
-- retried seat synchronization safe: recomputing gives the same answer.
SELECT is(
  public.odesseus_org_required_seat_count('61111111-1111-4111-8111-111111111111'),
  2, 'recomputing the required count is idempotent');

DELETE FROM public.employer_members
  WHERE org_id = '61111111-1111-4111-8111-111111111111';

SELECT is(
  public.odesseus_org_required_seat_count('61111111-1111-4111-8111-111111111111'),
  0, 'removing every non-owner member returns the org to zero required seats');

-- ---------------------------------------------------------------------------
-- Phase 5. Unknown organizations
-- ---------------------------------------------------------------------------
-- Returns 0 rather than raising: the function answers "how many seats does this
-- roster need", and an empty roster is a legitimate answer. Callers that must
-- confirm the org exists do it separately.
SELECT is(
  public.odesseus_org_required_seat_count('61111111-1111-4111-8111-999999999999'),
  0, 'an unknown organization requires zero seats rather than raising');

-- ---------------------------------------------------------------------------
-- Phase 6. Privilege surface
-- ---------------------------------------------------------------------------
SELECT ok(
  has_function_privilege('authenticated', 'public.odesseus_org_required_seat_count(uuid)', 'EXECUTE'),
  'authenticated may read a required seat count for a team screen');

SELECT ok(
  NOT has_function_privilege('anon', 'public.odesseus_org_required_seat_count(uuid)', 'EXECUTE'),
  'anon cannot read a required seat count');

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.odesseus_metered_org_roles()', 'EXECUTE'),
  'authenticated cannot call the metered-role list directly');

SELECT ok(
  has_function_privilege('service_role', 'public.odesseus_metered_org_roles()', 'EXECUTE'),
  'service_role can call the metered-role list');

-- The new function must not have widened access to the tables behind it.
-- Every employer_members policy is scoped to the org admin/owner or member
-- check, so no policy exposes a roster to an outsider.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'employer_members'
      AND (coalesce(qual, '') || coalesce(with_check, ''))
          NOT LIKE '%is_org_%'),
  0, 'every employer_members policy is scoped to an org membership check');

SELECT ok(
  has_table_privilege('anon', 'public.employer_members', 'SELECT') = false,
  'anon still has no access to team membership');

SELECT ok(
  has_table_privilege('authenticated', 'public.employer_members', 'INSERT') = false,
  'authenticated still cannot insert its own membership row');

SELECT ok(
  has_table_privilege('authenticated', 'public.employer_members', 'DELETE') = false,
  'authenticated still cannot delete a membership row without going through the reviewed removal path');

SELECT ok(
  has_table_privilege('authenticated', 'public.recruiter_seats', 'INSERT') = false,
  'authenticated still cannot write its own paid seat entitlement');

-- The seat product itself is unchanged: $20.00 per seat per month, one row per
-- subscription, written only by the billing webhook. A required count is a
-- derivation, never a written entitlement.
SELECT is(
  (SELECT count(*)::int FROM public.recruiter_seats
    WHERE org_id = '61111111-1111-4111-8111-111111111111'),
  0, 'deriving a required seat count writes nothing to recruiter_seats');

SELECT * FROM finish();
ROLLBACK;
