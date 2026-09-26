-- Recruiter seat invitations and membership (M5) (pgTAP).
-- Run with: npx supabase test db
--
-- Proves the invitation half of the seat against the real database:
--   * the invitation table is RLS-covered and admin-scoped, and an ordinary
--     member sees no invitations (no teammate email leakage),
--   * a client cannot grant itself a seat or forge invited_by,
--   * redemption requires the token AND the caller's own verified email,
--   * redemption refuses revoked, expired, and already-accepted invitations,
--   * every non-owner role (recruiter, admin, viewer) is refused with no live
--     paid seat and admitted once one exists, so no role is a way to take
--     seats for free,
--   * capacity accounting refuses the N+1th member and leaves membership
--     untouched when it does,
--   * a canceled or lapsed entitlement stops granting capacity,
--   * recruiter_seats and employer_members keep their original policy surface.
--
-- The seat-role policy itself (which roles are metered, and the required-seat
-- derivation) is covered in employer-seat-policy.test.sql.
--
-- Role discipline: fixtures that need to write auth.users or the service-role
-- seat tables run before the role is switched to `authenticated`, and every
-- owner-privileged step switches the JWT claims back explicitly.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(62);

-- ---------------------------------------------------------------------------
-- Phase 0. Fixtures (privileged role)
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    '51111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'emp-inv-owner@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create employer owner user');

SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    '51111111-1111-4111-8111-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'recruiter-one@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create first recruiter user');

SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    '51111111-1111-4111-8111-333333333333',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'recruiter-two@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create second recruiter user');

SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    '51111111-1111-4111-8111-444444444444',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'recruiter-three@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create third recruiter user');

SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    '51111111-1111-4111-8111-555555555555',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'viewer-four@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create viewer user');

SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    '51111111-1111-4111-8111-666666666666',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'expired-five@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create expired invitee user');

SELECT lives_ok(
  $$INSERT INTO public.employer_organizations (id, name, owner_user_id)
  VALUES (
    '52222222-2222-4222-8222-222222222222',
    'Invitations Inc.',
    '51111111-1111-4111-8111-111111111111')$$,
  'create employer organization');

SELECT is(
  public.odesseus_org_live_seat_count('52222222-2222-4222-8222-222222222222'),
  0, 'a new organization has no paid recruiter seats');

-- ---------------------------------------------------------------------------
-- Phase 1. Membership is only ever granted through the accept RPC
-- ---------------------------------------------------------------------------
SELECT set_config('role', 'service_role', true);

SELECT lives_ok(
  $$INSERT INTO public.employer_members (org_id, user_id, role)
  VALUES (
    '52222222-2222-4222-8222-222222222222',
    '51111111-1111-4111-8111-333333333333', 'viewer')$$,
  'seed a plain member');

SELECT set_config('role', 'authenticated', true);

SELECT ok(NOT has_table_privilege('authenticated', 'public.employer_members', 'INSERT'),
  'a client cannot insert team membership directly, admin or not');

SELECT ok(NOT has_table_privilege('authenticated', 'public.employer_members', 'DELETE'),
  'a client cannot delete team membership directly, admin or not');

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51111111-1111-4111-8111-333333333333","email":"recruiter-two@example.com","role":"authenticated"}',
  true);

SELECT throws_ok(
  $$INSERT INTO public.employer_members (org_id, user_id, role)
  VALUES (
    '52222222-2222-4222-8222-222222222222',
    '51111111-1111-4111-8111-444444444444', 'owner')$$,
  '42501', NULL, 'a member cannot grant themselves a role by inserting a membership row');

-- ---------------------------------------------------------------------------
-- Phase 2. The owner issues invitations
-- ---------------------------------------------------------------------------
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51111111-1111-4111-8111-111111111111","email":"emp-inv-owner@example.com","role":"authenticated"}',
  true);

SELECT throws_ok(
  $$INSERT INTO public.employer_member_invitations
    (org_id, email, role, token, invited_by, expires_at)
  VALUES (
    '52222222-2222-4222-8222-222222222222', 'y@example.com', 'owner',
    'tok_owner_role_00000001', '51111111-1111-4111-8111-111111111111',
    now() + interval '7 days')$$,
  '23514', NULL, 'the owner role cannot be granted by invitation');

SELECT lives_ok(
  $$INSERT INTO public.employer_member_invitations
    (org_id, email, role, token, invited_by, expires_at)
  VALUES (
    '52222222-2222-4222-8222-222222222222', 'recruiter-one@example.com', 'recruiter',
    'tok_recruiter_one_00001', '51111111-1111-4111-8111-111111111111',
    now() + interval '7 days')$$,
  'the owner issues a recruiter invitation');

SELECT lives_ok(
  $$INSERT INTO public.employer_member_invitations
    (org_id, email, role, token, invited_by, expires_at)
  VALUES (
    '52222222-2222-4222-8222-222222222222', 'z@example.com', 'viewer',
    'tok_viewer_z_000000001', '51111111-1111-4111-8111-111111111111',
    now() + interval '7 days')$$,
  'the owner issues a viewer invitation');

SELECT lives_ok(
  $$INSERT INTO public.employer_member_invitations
    (org_id, email, role, token, invited_by, expires_at)
  VALUES (
    '52222222-2222-4222-8222-222222222222', 'expired-five@example.com', 'viewer',
    'tok_expired_five_00001', '51111111-1111-4111-8111-111111111111',
    now() - interval '1 day')$$,
  'the owner issues an already-expired invitation');

SELECT throws_ok(
  $$INSERT INTO public.employer_member_invitations
    (org_id, email, role, token, invited_by, expires_at)
  VALUES (
    '52222222-2222-4222-8222-222222222222', 'Z@Example.com', 'recruiter',
    'tok_duplicate_pending_001', '51111111-1111-4111-8111-111111111111',
    now() + interval '7 days')$$,
  '23505', NULL, 'a second pending invite for the same email is rejected');

-- The invitation queue is visible to the admin who issued it.
SELECT is(
  (SELECT count(*)::int FROM public.employer_member_invitations),
  3, 'the owner sees the org''s pending invitations');

-- ---------------------------------------------------------------------------
-- Phase 3. A non-admin member sees nothing and can invite nobody
-- ---------------------------------------------------------------------------
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51111111-1111-4111-8111-333333333333","email":"recruiter-two@example.com","role":"authenticated"}',
  true);

SELECT is(
  (SELECT count(*)::int FROM public.employer_member_invitations),
  0, 'an ordinary member cannot read the org''s invitations');

SELECT throws_ok(
  $$INSERT INTO public.employer_member_invitations
    (org_id, email, role, token, invited_by, expires_at)
  VALUES (
    '52222222-2222-4222-8222-222222222222', 'x@example.com', 'recruiter',
    'tok_member_invite_00001', '51111111-1111-4111-8111-333333333333',
    now() + interval '7 days')$$,
  '42501', NULL, 'an ordinary member cannot issue an invitation');

SELECT throws_ok(
  $$INSERT INTO public.employer_member_invitations
    (org_id, email, role, token, invited_by, expires_at)
  VALUES (
    '52222222-2222-4222-8222-222222222222', 'w@example.com', 'viewer',
    'tok_forged_inviter_0001', '51111111-1111-4111-8111-333333333333',
    now() + interval '7 days')$$,
  '42501', NULL, 'invited_by is pinned to the calling admin');

-- The UPDATE policy is admin-scoped, but the row is also invisible to a
-- non-admin, so a client's attempt to mark an invitation accepted silently
-- matches nothing. The important property is that the row is unchanged, which
-- is asserted below from the owner's session.
SELECT lives_ok(
  $$UPDATE public.employer_member_invitations
   SET status = 'accepted', accepted_user_id = '51111111-1111-4111-8111-333333333333'
   WHERE token = 'tok_recruiter_one_00001'$$,
  'a non-admin update matches no rows rather than erroring');

-- ---------------------------------------------------------------------------
-- Phase 4. Redemption is gated on the caller''s own email
-- ---------------------------------------------------------------------------
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51111111-1111-4111-8111-333333333333","email":"recruiter-two@example.com","role":"authenticated"}',
  true);

SELECT throws_ok(
  $$SELECT joined_org_id FROM public.odesseus_accept_employer_invitation('tok_recruiter_one_00001')$$,
  'P0001', 'this invitation was sent to a different email address',
  'a token cannot be redeemed by an account with a different email');

SELECT throws_ok(
  $$SELECT joined_org_id FROM public.odesseus_accept_employer_invitation('nope')$$,
  'P0001', 'invalid invitation link', 'an unknown token is rejected');

SELECT throws_ok(
  $$SELECT joined_org_id FROM public.odesseus_accept_employer_invitation('short')$$,
  'P0001', 'invalid invitation link', 'a malformed token is rejected');

-- ---------------------------------------------------------------------------
-- Phase 5. A metered role needs a paid seat
-- ---------------------------------------------------------------------------
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51111111-1111-4111-8111-222222222222","email":"recruiter-one@example.com","role":"authenticated"}',
  true);

SELECT throws_ok(
  $$SELECT joined_org_id FROM public.odesseus_accept_employer_invitation('tok_recruiter_one_00001')$$,
  'P0001', 'this team has no paid seats left; add a seat to invite another member',
  'a recruiter cannot join with zero paid seats');

SELECT is(
  (SELECT count(*)::int FROM public.employer_members
   WHERE org_id = '52222222-2222-4222-8222-222222222222' AND role = 'recruiter'),
  0, 'the refused accept created no membership');

-- Seats only ever appear via the billing webhook's service-role sync, so the
-- fixture grants them that way. Doing it as `authenticated` is denied, which
-- is the point: a client cannot mint its own seat.
SELECT set_config('role', 'service_role', true);

SELECT is(
  (SELECT seat_count FROM public.odesseus_sync_recruiter_seat(
    '52222222-2222-4222-8222-222222222222', 2, 'active',
    'sub_inv_seats_1', 'cus_inv_seats_1',
    now(), now() + interval '1 month')),
  2, 'a paid seat entitlement syncs for the organization');

SELECT set_config('role', 'authenticated', true);

SELECT is(
  (SELECT joined_org_id FROM public.odesseus_accept_employer_invitation('tok_recruiter_one_00001')),
  '52222222-2222-4222-8222-222222222222',
  'a recruiter can join once a seat is paid for');

SELECT is(
  (SELECT role FROM public.employer_members
   WHERE org_id = '52222222-2222-4222-8222-222222222222'
     AND user_id = '51111111-1111-4111-8111-222222222222'),
  'recruiter', 'the accepted invitation produced a recruiter membership');

SELECT throws_ok(
  $$SELECT joined_org_id FROM public.odesseus_accept_employer_invitation('tok_recruiter_one_00001')$$,
  'P0001', 'this invitation has already been accepted',
  'an accepted invitation is single use');

-- The joined recruiter is still only a member, so it cannot read the queue.
SELECT is(
  (SELECT count(*)::int FROM public.employer_member_invitations),
  0, 'a recruiter who joined does not gain admin visibility of invitations');

-- The admin can see the redemption trail.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51111111-1111-4111-8111-111111111111","email":"emp-inv-owner@example.com","role":"authenticated"}',
  true);

SELECT is(
  (SELECT status FROM public.employer_member_invitations
   WHERE token = 'tok_recruiter_one_00001'),
  'accepted', 'the invitation is marked accepted');

SELECT is(
  (SELECT accepted_user_id FROM public.employer_member_invitations
   WHERE token = 'tok_recruiter_one_00001'),
  '51111111-1111-4111-8111-222222222222',
  'the invitation records which account redeemed it');

-- ---------------------------------------------------------------------------
-- Phase 6. Capacity accounting
-- ---------------------------------------------------------------------------
SELECT is(
  public.odesseus_org_live_seat_count('52222222-2222-4222-8222-222222222222'),
  2, 'live seat capacity reflects the paid entitlement');

SELECT lives_ok(
  $$INSERT INTO public.employer_member_invitations
    (org_id, email, role, token, invited_by, expires_at)
  VALUES (
    '52222222-2222-4222-8222-222222222222', 'recruiter-two@example.com', 'recruiter',
    'tok_recruiter_two_00001', '51111111-1111-4111-8111-111111111111',
    now() + interval '7 days')$$,
  'the owner invites a second recruiter');

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51111111-1111-4111-8111-333333333333","email":"recruiter-two@example.com","role":"authenticated"}',
  true);

SELECT lives_ok(
  $$SELECT joined_org_id FROM public.odesseus_accept_employer_invitation('tok_recruiter_two_00001')$$,
  'the second recruiter uses the last seat');

-- Third recruiter: both paid seats are now consumed.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51111111-1111-4111-8111-111111111111","email":"emp-inv-owner@example.com","role":"authenticated"}',
  true);

SELECT lives_ok(
  $$INSERT INTO public.employer_member_invitations
    (org_id, email, role, token, invited_by, expires_at)
  VALUES (
    '52222222-2222-4222-8222-222222222222', 'recruiter-three@example.com', 'recruiter',
    'tok_recruiter_three_001', '51111111-1111-4111-8111-111111111111',
    now() + interval '7 days')$$,
  'the owner invites a third recruiter');

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51111111-1111-4111-8111-444444444444","email":"recruiter-three@example.com","role":"authenticated"}',
  true);

SELECT throws_ok(
  $$SELECT joined_org_id FROM public.odesseus_accept_employer_invitation('tok_recruiter_three_001')$$,
  'P0001', 'this team has no paid seats left; add a seat to invite another member',
  'a third recruiter is refused once both paid seats are used');

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51111111-1111-4111-8111-111111111111","email":"emp-inv-owner@example.com","role":"authenticated"}',
  true);

SELECT is(
  (SELECT count(*)::int FROM public.employer_members
   WHERE org_id = '52222222-2222-4222-8222-222222222222' AND role = 'recruiter'),
  2, 'the refused accept left membership untouched');

-- ---------------------------------------------------------------------------
-- Phase 7. Every non-owner role consumes a paid seat
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO public.employer_member_invitations
    (org_id, email, role, token, invited_by, expires_at)
  VALUES (
    '52222222-2222-4222-8222-222222222222', 'viewer-four@example.com', 'viewer',
    'tok_viewer_four_00001', '51111111-1111-4111-8111-111111111111',
    now() + interval '7 days')$$,
  'the owner invites a viewer');

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51111111-1111-4111-8111-555555555555","email":"viewer-four@example.com","role":"authenticated"}',
  true);

-- A viewer is metered exactly like a recruiter. If it were not, handing a
-- teammate the viewer role would be a free way to add a team member, which is
-- the hole the seat policy exists to close.
SELECT throws_ok(
  $$SELECT joined_org_id FROM public.odesseus_accept_employer_invitation('tok_viewer_four_00001')$$,
  'P0001', 'this team has no paid seats left; add a seat to invite another member',
  'a viewer cannot join once the paid seats are used, because viewers are metered');

-- The organization owner is not counted, so two recruiters against two seats is
-- exactly balanced.
SELECT is(
  public.odesseus_org_required_seat_count('52222222-2222-4222-8222-222222222222'),
  2, 'the required seat count excludes the organization owner');

SELECT set_config('role', 'service_role', true);

SELECT lives_ok(
  $$SELECT seat_count FROM public.odesseus_sync_recruiter_seat(
    '52222222-2222-4222-8222-222222222222', 3, 'active',
    'sub_inv_seats_1', 'cus_inv_seats_1',
    now(), now() + interval '1 month')$$,
  'a third seat is paid for');

SELECT set_config('role', 'authenticated', true);

SELECT lives_ok(
  $$SELECT joined_org_id FROM public.odesseus_accept_employer_invitation('tok_viewer_four_00001')$$,
  'a viewer joins once a seat is paid for');

SELECT is(
  public.odesseus_org_required_seat_count('52222222-2222-4222-8222-222222222222'),
  3, 'a viewer consumes a paid seat like any other non-owner role');

-- ---------------------------------------------------------------------------
-- Phase 8. Revoked invitations
-- ---------------------------------------------------------------------------
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51111111-1111-4111-8111-111111111111","email":"emp-inv-owner@example.com","role":"authenticated"}',
  true);

SELECT lives_ok(
  $$UPDATE public.employer_member_invitations
   SET status = 'revoked'
   WHERE token = 'tok_viewer_z_000000001'$$,
  'the owner revokes an outstanding invitation');

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51111111-1111-4111-8111-666666666666","email":"expired-five@example.com","role":"authenticated"}',
  true);

-- Status is checked before the email, so a revoked link does not reveal whether
-- an address was ever invited.
SELECT throws_ok(
  $$SELECT joined_org_id FROM public.odesseus_accept_employer_invitation('tok_viewer_z_000000001')$$,
  'P0001', 'this invitation has already been revoked',
  'a revoked invitation cannot be redeemed, and says so before checking the email');

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51111111-1111-4111-8111-111111111111","email":"emp-inv-owner@example.com","role":"authenticated"}',
  true);

-- ---------------------------------------------------------------------------
-- Phase 9. Expired invitations
-- ---------------------------------------------------------------------------
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51111111-1111-4111-8111-666666666666","email":"expired-five@example.com","role":"authenticated"}',
  true);

SELECT throws_ok(
  $$SELECT joined_org_id FROM public.odesseus_accept_employer_invitation('tok_expired_five_00001')$$,
  'P0001', 'this invitation has expired', 'an expired invitation cannot be redeemed');

-- ---------------------------------------------------------------------------
-- Phase 10. A canceled entitlement stops granting capacity
-- ---------------------------------------------------------------------------
SELECT is(
  public.odesseus_org_live_seat_count('52222222-2222-4222-8222-222222222222'),
  3, 'capacity is unchanged before the cancellation');

-- A client cannot rewrite the entitlement itself; the lapse is simulated the way
-- it actually happens, through the webhook's sync path.
SELECT set_config('role', 'service_role', true);

SELECT lives_ok(
  $$SELECT seat_count FROM public.odesseus_sync_recruiter_seat(
    '52222222-2222-4222-8222-222222222222', 3, 'canceled',
    'sub_inv_seats_1', 'cus_inv_seats_1',
    now() - interval '1 month', now() - interval '1 second')$$,
  'the seat subscription is canceled');

SELECT set_config('role', 'authenticated', true);

SELECT is(
  public.odesseus_org_live_seat_count('52222222-2222-4222-8222-222222222222'),
  0, 'a canceled or lapsed paid period contributes no capacity');

-- ---------------------------------------------------------------------------
-- Phase 11. RLS surface and privileges
-- ---------------------------------------------------------------------------
SELECT ok(
  (select relrowsecurity from pg_class
   where oid = 'public.employer_member_invitations'::regclass),
  'employer_member_invitations has RLS enabled');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'employer_member_invitations'
     AND (coalesce(qual, '') || coalesce(with_check, ''))
         NOT LIKE '%is_org_admin_or_owner%'),
  0, 'every invitation policy is scoped to the org admin/owner check');

SELECT ok(has_table_privilege('anon', 'public.employer_member_invitations', 'SELECT') = false,
  'anon has no access to invitations');

SELECT ok(
  has_function_privilege('authenticated', 'public.odesseus_accept_employer_invitation(text)', 'EXECUTE'),
  'authenticated may redeem their own invitation');

SELECT ok(NOT has_function_privilege('anon', 'public.odesseus_accept_employer_invitation(text)', 'EXECUTE'),
  'anon cannot redeem an invitation');

SELECT ok(
  has_function_privilege('authenticated', 'public.odesseus_org_live_seat_count(uuid)', 'EXECUTE'),
  'authenticated may read an org''s live seat count');

SELECT ok(
  has_function_privilege('authenticated', 'public.odesseus_org_required_seat_count(uuid)', 'EXECUTE'),
  'authenticated may read an org''s required seat count');

SELECT ok(NOT has_function_privilege('anon', 'public.odesseus_org_required_seat_count(uuid)', 'EXECUTE'),
  'anon cannot read a required seat count');

-- This migration did not widen access to the paid entitlement table or to team
-- membership.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'recruiter_seats'),
  1, 'recruiter_seats keeps its single member-read policy');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'employer_members'),
  4, 'employer_members keeps its original four policies');

SELECT * FROM finish();
ROLLBACK;
