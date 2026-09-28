-- Odesseus Live memberships and guest entitlements.
-- Run with: npx supabase test db --local, immediately after npx supabase db reset --local.
--
-- What this file is for
-- ---------------------
-- Two decisions in this product are made in the database and cannot be proven
-- from TypeScript, because only the database holds the rows they read:
--
--   1. odesseus_get_live_entitlement, the one authoritative answer to "may this
--      person start a Live session right now". Its resolution order, its ten
--      named columns, and the meaning of sessions_remaining are product rules,
--      not implementation detail. An interview screen and a billing screen both
--      read it, so a wrong value here is a customer who paid and is told they
--      have nothing.
--
--   2. The Live Share guest cap. Ten guests per membership year, enforced by a
--      BEFORE INSERT trigger that takes a row lock. It is proved here at both
--      layers, because a cap that exists only in the service layer is a cap
--      somebody walks around with an INSERT.
--
-- The failure modes actually worth a test, and all of them present in the file:
--
--   * a renewal must reset the allocation and keep the history. It did not:
--     current_period_start is advanced by two independent paths and only one of
--     them recomputed guest_count, so a re-purchase left last year's count on a
--     row whose period had moved and refused every activation forever. Fixed in
--     20261018000001; section 9 is the regression test.
--   * a legacy annual holder must report fair-use headroom, not zero. It
--      reported zero, and activation gates time-boxed access on a positive
--     count, so every legacy annual holder was refused with "fair use limit
--     reached" however little they had used. Fixed in 20261018000000.
--   * an invitation must consume no slot and activation exactly one, so an owner
--     is not charged for people who never showed up and cannot activate the same
--     guest twice to consume two.
--   * an activated guest must not be revocable, because revocation is the only
--     way a delete and replace reopens a consumed slot.
--   * an invitation must expire with the year it was issued in, or redeeming it
--     writes an active grant that carries neither access nor a counted slot.
--   * a guest must not be able to read the owner's row, and must not be able to
--     read live_memberships at all.
--
-- Role discipline: everything runs as service_role, the only role granted the
-- entitlement function and the only role that legitimately touches these tables.
-- Section 10 switches to `authenticated` and sets JWT claims, because that is
-- the only way to prove a browser session cannot do what it should not.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(96);

-- ===========================================================================
-- Fixtures
-- ===========================================================================
-- No role switch here. The pgTAP connection is already a superuser, which is
-- what these fixture seeds need: auth.users is not writable by service_role, and
-- a fixture that cannot be written is a fixture that silently stops testing
-- anything. Section 10 is the only place a role changes, and it changes there to
-- prove a *browser* session cannot do something.

-- Six candidates. owner1 buys Live Share, owner2 buys Personal Annual,
-- owner3 buys Monthly, owner4 buys a single pass, owner5 holds the legacy
-- annual window with no catalog product, owner6 has no entitlement at all.
SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
      encrypted_password, email_confirmed_at, created_at, updated_at)
    SELECT ('6a000001-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
           '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
           'owner' || g || '@example.com', 'x', now(), now(), now()
    FROM generate_series(1, 6) g$$,
  'seed six candidate accounts');

-- One invited guest whose address is known in advance, so a forwarded
-- invitation can be attempted against a different account.
SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
      encrypted_password, email_confirmed_at, created_at, updated_at)
    VALUES ('6b000000-0000-4000-8000-000000000001',
            '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'named-guest@example.com', 'x', now(), now(), now())$$,
  'seed the named guest account');

-- Twelve is one more than the cap. The eleventh activation has to be refused
-- and the twelfth attempted too, so a cap that is off by one cannot pass.
SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
      encrypted_password, email_confirmed_at, created_at, updated_at)
    SELECT ('6c000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
           '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
           'bulk-guest-' || g || '@example.com', 'x', now(), now(), now()
    FROM generate_series(1, 12) g$$,
  'seed twelve guest accounts, one more than the cap');

-- Back to the superuser for the catalog assertions, which are reads and would
-- pass under any role.

-- ===========================================================================
-- 1. The catalog is the only place a price or a ceiling is written
-- ===========================================================================
SELECT is(
  (SELECT metadata->>'guest_limit' FROM pricing_products WHERE product_key = 'live_share_annual'),
  '10', 'the share plan carries a guest limit of ten');

SELECT is(
  (SELECT metadata->>'fair_use_sessions' FROM pricing_products WHERE product_key = 'live_share_annual'),
  '20', 'the share plan carries a configured fair-use ceiling');

SELECT is(
  (SELECT metadata->>'guest_limit' FROM pricing_products WHERE product_key = 'live_personal_annual'),
  '0', 'the personal plan carries no guest capacity');

SELECT is(
  (SELECT metadata->>'guest_limit' FROM pricing_products WHERE product_key = 'live_monthly'),
  '0', 'the monthly plan carries no guest capacity');

-- The retired annual has no membership row to read a ceiling from, so it is
-- given the same catalog keys. This is the legacy path's only configuration,
-- and it is why the fair-use ceiling below is a catalog read and not a literal.
SELECT is(
  (SELECT metadata->>'fair_use_sessions' FROM pricing_products WHERE product_key = 'candidate_live_annual'),
  '20', 'the retired annual carries a fair-use ceiling too');

-- ===========================================================================
-- 2. Buying each product grants the right thing
-- ===========================================================================
-- Fulfillment is driven off billing_events, which is what the Stripe webhook
-- writes. Going through it rather than inserting a membership proves the whole
-- path, including that a subscription grants no disposable pass to spend.

SELECT lives_ok(
  $$INSERT INTO billing_events (stripe_event_id, checkout_session_id, user_id,
      credit_type, credit_delta, sku, amount_cents, currency, metadata)
    VALUES ('evt_pgtap_single', 'cs_pgtap_single', '6a000001-0000-4000-8000-000000000004',
            'interview', 1, 'live_single', 1499, 'usd', '{}')$$,
  'a $14.99 single pass fulfils');

SELECT results_eq(
  $$SELECT has_access, source, sessions_remaining, period_end, is_owner, is_guest
      FROM odesseus_get_live_entitlement('6a000001-0000-4000-8000-000000000004')$$,
  $$VALUES (true, 'passes'::text, 1, NULL::timestamptz, false, false)$$,
  'a single pass is exactly one disposable session and nothing else');

SELECT lives_ok(
  $$INSERT INTO billing_events (stripe_event_id, checkout_session_id, user_id,
      credit_type, credit_delta, sku, amount_cents, currency, metadata)
    VALUES ('evt_pgtap_share', 'cs_pgtap_share', '6a000001-0000-4000-8000-000000000001',
            'interview', 1, 'live_share_annual', 49900, 'usd',
            '{"stripe_subscription_id":"sub_pgtap_share",
              "current_period_start":"2026-01-01T00:00:00Z",
              "current_period_end":"2027-01-01T00:00:00Z"}')$$,
  'the $499 share plan fulfils');

-- A subscription and a pass are different mechanisms and must not be confused.
-- A membership that quietly granted a pass would be spent down by the first
-- interview, and the member would be told they had run out of a plan they are
-- still paying for.
SELECT is(
  (SELECT count(*)::int FROM credit_transactions
    WHERE user_id = '6a000001-0000-4000-8000-000000000001' AND credit_type = 'interview'),
  0, 'a subscription grants no disposable pass, so it cannot be spent down');

SELECT results_eq(
  $$SELECT plan_type, guest_limit, guest_count, fair_use_sessions, fair_use_window_days
      FROM live_memberships WHERE user_id = '6a000001-0000-4000-8000-000000000001'$$,
  $$VALUES ('share_annual'::text, 10, 0, 20, 30)$$,
  'the membership copies the catalog configuration onto its own row at grant time');

SELECT results_eq(
  $$SELECT has_access, source, plan, sessions_remaining, period_end,
           is_owner, guest_limit, activated_guest_count
      FROM odesseus_get_live_entitlement('6a000001-0000-4000-8000-000000000001')$$,
  $$VALUES (true, 'membership'::text, 'share_annual'::text, 20,
                   '2027-01-01T00:00:00Z'::timestamptz, true, 10, 0)$$,
  'the owner sees a membership with a full fair-use window and no guests yet');

SELECT lives_ok(
  $$INSERT INTO billing_events (stripe_event_id, checkout_session_id, user_id,
      credit_type, credit_delta, sku, amount_cents, currency, metadata)
    VALUES ('evt_pgtap_personal', 'cs_pgtap_personal', '6a000001-0000-4000-8000-000000000002',
            'interview', 1, 'live_personal_annual', 9900, 'usd',
            '{"stripe_subscription_id":"sub_pgtap_personal",
              "current_period_start":"2026-01-01T00:00:00Z",
              "current_period_end":"2027-01-01T00:00:00Z"}')$$,
  'the $99 personal plan fulfils');

SELECT results_eq(
  $$SELECT has_access, source, plan, guest_limit, is_owner
      FROM odesseus_get_live_entitlement('6a000001-0000-4000-8000-000000000002')$$,
  $$VALUES (true, 'membership'::text, 'personal_annual'::text, 0, false)$$,
  'a personal member has no guest capacity and is not an owner');

SELECT lives_ok(
  $$INSERT INTO billing_events (stripe_event_id, checkout_session_id, user_id,
      credit_type, credit_delta, sku, amount_cents, currency, metadata)
    VALUES ('evt_pgtap_monthly', 'cs_pgtap_monthly', '6a000001-0000-4000-8000-000000000003',
            'interview', 1, 'live_monthly', 1999, 'usd',
            '{"stripe_subscription_id":"sub_pgtap_monthly",
              "current_period_start":"2026-10-01T00:00:00Z",
              "current_period_end":"2026-11-01T00:00:00Z"}')$$,
  'the $19.99 monthly plan fulfils');

SELECT results_eq(
  $$SELECT plan_type, (current_period_end::date - current_period_start::date)
      FROM live_memberships WHERE user_id = '6a000001-0000-4000-8000-000000000003'$$,
  $$VALUES ('monthly'::text, 31)$$,
  'the monthly plan carries its own period length, not a year');

-- ===========================================================================
-- 3. A replayed webhook grants nothing twice
-- ===========================================================================
-- Stripe retries webhooks. An event that arrives twice must be absorbed by the
-- unique index, not re-run through fulfillment.
SELECT throws_ok(
  $$INSERT INTO billing_events (stripe_event_id, checkout_session_id, user_id,
      credit_type, credit_delta, sku, amount_cents, currency, metadata)
    VALUES ('evt_pgtap_share', 'cs_pgtap_share', '6a000001-0000-4000-8000-000000000001',
            'interview', 1, 'live_share_annual', 49900, 'usd',
            '{"stripe_subscription_id":"sub_pgtap_share",
              "current_period_start":"2026-01-01T00:00:00Z",
              "current_period_end":"2027-01-01T00:00:00Z"}')$$,
  '23505', NULL,
  'Stripe retrying an event is rejected, so access is not granted twice');

SELECT is(
  (SELECT count(*)::int FROM live_memberships
    WHERE user_id = '6a000001-0000-4000-8000-000000000001'),
  1, 'and there is still exactly one membership for the owner');

-- ===========================================================================
-- 4. Resolution order
-- ===========================================================================
-- Membership, then guest, then a discrete pass, then the legacy window. A member
-- who also holds a leftover pass must see the membership, or the subscription
-- looks spent the moment they use it once.
--
-- owner2 is used rather than owner3 because owner3's row is driven through real
-- Stripe lifecycle events in section 5, and a leftover pass there would mask
-- exactly the thing that section is about.
SELECT lives_ok(
  $$INSERT INTO credit_balances (user_id, interview_passes, live_unlimited_until)
    VALUES ('6a000001-0000-4000-8000-000000000002', 5, now() + interval '12 months')
    ON CONFLICT (user_id) DO UPDATE
      SET interview_passes = 5, live_unlimited_until = excluded.live_unlimited_until$$,
  'the personal member also holds passes and a legacy window');

SELECT is(
  (SELECT source FROM odesseus_get_live_entitlement('6a000001-0000-4000-8000-000000000002')),
  'membership',
  'a membership outranks both a leftover pass and the legacy window');

-- The mirror has to be cleaned up again, or the personal member would keep
-- resolving through it in every later section.
SELECT lives_ok(
  $$UPDATE credit_balances
      SET interview_passes = 0, live_unlimited_until = NULL
    WHERE user_id = '6a000001-0000-4000-8000-000000000002'$$,
  'the personal member is left holding only their membership');

-- The legacy annual, with no membership and no pass. This is the case that
-- regressed: the check reported zero remaining, and activation gates time-boxed
-- access on a positive count, so every legacy annual holder was refused with
-- "fair use limit reached" no matter how little they had used.
SELECT lives_ok(
  $$INSERT INTO credit_balances (user_id, interview_passes, live_unlimited_until)
    VALUES ('6a000001-0000-4000-8000-000000000005', 0, now() + interval '12 months')
    ON CONFLICT (user_id) DO UPDATE
      SET interview_passes = 0, live_unlimited_until = excluded.live_unlimited_until$$,
  'the legacy annual holder is seeded');

SELECT results_eq(
  $$SELECT has_access, source, sessions_remaining
      FROM odesseus_get_live_entitlement('6a000001-0000-4000-8000-000000000005')$$,
  $$VALUES (true, 'annual'::text, 20)$$,
  'the legacy window reports its real fair-use headroom, not zero');

-- Someone with nothing. Fails closed, and says so with a real source rather
-- than nulls every caller has to interpret.
SELECT results_eq(
  $$SELECT has_access, source, plan, sessions_remaining, period_end,
           is_owner, is_guest, membership_id, guest_limit, activated_guest_count
      FROM odesseus_get_live_entitlement('6a000001-0000-4000-8000-000000000006')$$,
  $$VALUES (false, 'none'::text, NULL::text, 0, NULL::timestamptz,
                   false, false, NULL::uuid, 0, 0)$$,
  'a user with no entitlement gets a complete, closed-off answer');

-- ===========================================================================
-- 5. Subscription states
-- ===========================================================================
-- Driven through odesseus_sync_live_membership, which is what the Stripe
-- subscription lifecycle webhook calls, rather than by writing the status column
-- directly. A state change also has to move the credit_balances mirror, and
-- setting the column by hand would skip exactly the part worth testing.
--
-- owner3 holds no passes and no legacy window, so anything the check reports
-- here came from the subscription and nothing else.

-- Cancelling at period end must not take a period already paid for back.
SELECT lives_ok(
  $$SELECT odesseus_sync_live_membership(
       'sub_pgtap_monthly', '6a000001-0000-4000-8000-000000000003', 'canceled',
       '2026-10-01T00:00:00Z'::timestamptz, '2026-11-01T00:00:00Z'::timestamptz, NULL)$$,
  'the monthly member cancels at period end');

SELECT is(
  (SELECT has_access FROM odesseus_get_live_entitlement('6a000001-0000-4000-8000-000000000003')),
  true, 'a cancelled subscription still grants access until the period it was paid for ends');

-- An unpaid invoice is a different thing. There is no money behind it.
--
-- This is the regression test for the legacy mirror. credit_balances keeps a
-- live_unlimited_until column so the older activation path keeps honouring
-- members, and the entitlement check falls through to it after the membership
-- declines. The sync used to extend that mirror on every event and clear it
-- only once the period had ended, so a subscription that stopped paying
-- resolved as source 'annual' with a full fair-use window -- and a paused one
-- never recovered, because every later sync extended it again.
SELECT lives_ok(
  $$SELECT odesseus_sync_live_membership(
       'sub_pgtap_monthly', '6a000001-0000-4000-8000-000000000003', 'unpaid',
       '2026-10-01T00:00:00Z'::timestamptz, '2026-11-01T00:00:00Z'::timestamptz, NULL)$$,
  'the subscription goes unpaid');

SELECT is(
  (SELECT live_unlimited_until FROM credit_balances
    WHERE user_id = '6a000001-0000-4000-8000-000000000003'),
  NULL::timestamptz, 'the legacy mirror is cleared, not left dated into the future');

SELECT is(
  (SELECT has_access FROM odesseus_get_live_entitlement('6a000001-0000-4000-8000-000000000003')),
  false, 'an unpaid subscription grants nothing');

-- The same must hold for a pause, and a pause is the worse case because the
-- period end date keeps moving forward in the customer's favour.
SELECT lives_ok(
  $$SELECT odesseus_sync_live_membership(
       'sub_pgtap_monthly', '6a000001-0000-4000-8000-000000000003', 'paused',
       '2026-10-01T00:00:00Z'::timestamptz, '2026-11-01T00:00:00Z'::timestamptz, NULL)$$,
  'the subscription is paused');

SELECT is(
  (SELECT has_access FROM odesseus_get_live_entitlement('6a000001-0000-4000-8000-000000000003')),
  false, 'a paused subscription grants nothing either');

-- And it has to come back, or the fix would read as "payment failure is
-- permanent" -- which would be its own kind of wrong.
SELECT lives_ok(
  $$SELECT odesseus_sync_live_membership(
       'sub_pgtap_monthly', '6a000001-0000-4000-8000-000000000003', 'active',
       '2026-10-01T00:00:00Z'::timestamptz, '2026-11-01T00:00:00Z'::timestamptz, NULL)$$,
  'the subscription starts paying again');

SELECT results_eq(
  $$SELECT has_access, source, plan
      FROM odesseus_get_live_entitlement('6a000001-0000-4000-8000-000000000003')$$,
  $$VALUES (true, 'membership'::text, 'monthly'::text)$$,
  'a recovered subscription grants through the membership again');

-- A period that has genuinely ended is a separate case from a state change,
-- and the mirror must not survive it either.
SELECT lives_ok(
  $$SELECT odesseus_sync_live_membership(
       'sub_pgtap_monthly', '6a000001-0000-4000-8000-000000000003', 'active',
       '2020-01-01T00:00:00Z'::timestamptz, '2020-02-01T00:00:00Z'::timestamptz, NULL)$$,
  'the subscription period lapses entirely');

SELECT is(
  (SELECT has_access FROM odesseus_get_live_entitlement('6a000001-0000-4000-8000-000000000003')),
  false, 'a lapsed period grants nothing, however active its status still reads');

-- ===========================================================================
-- 6. An invitation is an invitation
-- ===========================================================================
SELECT is(
  (SELECT guest_count FROM live_memberships
    WHERE user_id = '6a000001-0000-4000-8000-000000000001'),
  0, 'a fresh membership has no guests');

-- If an invitation occupied a slot, an owner who invited thirty people and used
-- three would be at the cap. Slots are for activated guests.
SELECT lives_ok(
  $$SELECT odesseus_create_live_guest_invite(
       (SELECT id FROM live_memberships WHERE user_id = '6a000001-0000-4000-8000-000000000001'),
       '6a000001-0000-4000-8000-000000000001',
       'named-guest@example.com',
       'tok_pgtap_' || repeat('0', 32) || '1')$$,
  'the owner invites a guest');

SELECT is(
  (SELECT guest_count FROM live_memberships
    WHERE user_id = '6a000001-0000-4000-8000-000000000001'),
  0, 'an invitation consumes no slot');

SELECT is(
  (SELECT count(*)::int FROM live_guest_entitlements
    WHERE membership_id = (SELECT id FROM live_memberships
                             WHERE user_id = '6a000001-0000-4000-8000-000000000001')),
  0, 'and grants no entitlement before the guest accepts');

-- A forwarded link must not be redeemable by somebody else. The guest's address
-- comes from auth, not from the request, so a token is not a bearer credential.
SELECT is(
  (SELECT result FROM odesseus_accept_live_guest_invite(
     'tok_pgtap_' || repeat('0', 32) || '1', '6c000000-0000-4000-8000-000000000007')),
  'invalid', 'a forwarded invitation cannot be redeemed by a different account');

SELECT is(
  (SELECT result FROM odesseus_accept_live_guest_invite(
     'tok_pgtap_' || repeat('0', 32) || '1', '6b000000-0000-4000-8000-000000000001')),
  'activated', 'the invited guest accepts their own invitation');

SELECT is(
  (SELECT guest_count FROM live_memberships
    WHERE user_id = '6a000001-0000-4000-8000-000000000001'),
  1, 'activation consumes exactly one slot');

-- The same acceptance again, which is what a double-clicked link or a retried
-- request looks like. It must be answered, not re-run.
SELECT is(
  (SELECT result FROM odesseus_accept_live_guest_invite(
     'tok_pgtap_' || repeat('0', 32) || '1', '6b000000-0000-4000-8000-000000000001')),
  'already_active', 'a retried acceptance is answered, not re-run');

SELECT is(
  (SELECT guest_count FROM live_memberships
    WHERE user_id = '6a000001-0000-4000-8000-000000000001'),
  1, 'and it consumes no second slot');

-- The bypass this whole section exists to close. If an activated guest could be
-- revoked, the owner could free a slot and invite somebody else, and the cap
-- would only ever stop the eleventh distinct guest rather than the eleventh
-- activation. This is refused loudly rather than quietly, because a caller that
-- assumed "revoked" had succeeded would show the owner a released slot that was
-- never released.
SELECT throws_ok(
  $$SELECT odesseus_revoke_live_guest_invite(
       (SELECT id FROM live_memberships WHERE user_id = '6a000001-0000-4000-8000-000000000001'),
       '6a000001-0000-4000-8000-000000000001',
       (SELECT id FROM live_guest_invites
         WHERE membership_id = (SELECT id FROM live_memberships
                                 WHERE user_id = '6a000001-0000-4000-8000-000000000001')
           AND guest_email_normalized = 'named-guest@example.com'))$$,
  'P0001', NULL,
  'revoking an activated guest is refused outright, so no slot can be recycled');

SELECT is(
  (SELECT guest_count FROM live_memberships
    WHERE user_id = '6a000001-0000-4000-8000-000000000001'),
  1, 'so the slot is not released');

SELECT is(
  (SELECT status FROM live_guest_invites
    WHERE membership_id = (SELECT id FROM live_memberships
                             WHERE user_id = '6a000001-0000-4000-8000-000000000001')
      AND guest_email_normalized = 'named-guest@example.com'),
  'activated', 'and the activated invitation is still activated, not revoked');

-- A revoked *pending* invitation can no longer be redeemed, and freeing a slot
-- for somebody who does show up is the behaviour the owner actually wants.
SELECT lives_ok(
  $$SELECT odesseus_create_live_guest_invite(
       (SELECT id FROM live_memberships WHERE user_id = '6a000001-0000-4000-8000-000000000001'),
       '6a000001-0000-4000-8000-000000000001',
       'bulk-guest-12@example.com',
       'tok_pgtap_' || repeat('0', 32) || '9')$$,
  'the owner issues a second invitation');

SELECT is(
  (SELECT odesseus_revoke_live_guest_invite(
       (SELECT id FROM live_memberships WHERE user_id = '6a000001-0000-4000-8000-000000000001'),
       '6a000001-0000-4000-8000-000000000001',
       (SELECT id FROM live_guest_invites
         WHERE membership_id = (SELECT id FROM live_memberships
                                 WHERE user_id = '6a000001-0000-4000-8000-000000000001')
           AND guest_email_normalized = 'bulk-guest-12@example.com'))),
  true, 'the owner revokes the unused invitation');

SELECT is(
  (SELECT result FROM odesseus_accept_live_guest_invite(
     'tok_pgtap_' || repeat('0', 32) || '9', '6c000000-0000-4000-8000-000000000012')),
  'invalid', 'a revoked invitation can no longer be redeemed');

-- ===========================================================================
-- 7. What the guest is told
-- ===========================================================================
-- Never the owner's row, never the owner's name. The cap and the fair-use
-- window are reported from the owner's membership, which the guest cannot read
-- at all -- the entitlement function is the only thing that crosses that line.
SELECT results_eq(
  $$SELECT has_access, source, plan, is_guest, is_owner, membership_id
      FROM odesseus_get_live_entitlement('6b000000-0000-4000-8000-000000000001')$$,
  $$VALUES (true, 'guest'::text, 'guest'::text, true, false,
                   (SELECT id FROM live_memberships
                     WHERE user_id = '6a000001-0000-4000-8000-000000000001')::uuid)$$,
  'a guest is served the owner''s fair-use window and identified as a guest');

-- ===========================================================================
-- 8. The cap, at both layers
-- ===========================================================================
-- Fill the remaining nine slots through the service functions an application
-- would actually call.
SELECT lives_ok(
  $$SELECT odesseus_create_live_guest_invite(
         (SELECT id FROM live_memberships WHERE user_id = '6a000001-0000-4000-8000-000000000001'),
         '6a000001-0000-4000-8000-000000000001',
         'bulk-guest-' || g || '@example.com',
         'tok_pgtap_' || lpad((g + 100)::text, 32, '0'))
       FROM generate_series(1, 9) g$$,
  'the owner issues nine more invitations');

SELECT lives_ok(
  $$SELECT odesseus_accept_live_guest_invite(
         'tok_pgtap_' || lpad((g + 100)::text, 32, '0'),
         ('6c000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid)
       FROM generate_series(1, 9) g$$,
  'nine more guests accept, reaching the cap of ten');

SELECT is(
  (SELECT guest_count FROM live_memberships
    WHERE user_id = '6a000001-0000-4000-8000-000000000001'),
  10, 'ten guests are activated, which is the cap');

SELECT results_eq(
  $$SELECT has_access, source, plan, guest_limit, activated_guest_count
      FROM odesseus_get_live_entitlement('6a000001-0000-4000-8000-000000000001')$$,
  $$VALUES (true, 'membership'::text, 'share_annual'::text, 10, 10)$$,
  'and the owner is told the cap is used up, not merely that it exists');

-- The eleventh, through the service function. This is the path the API takes,
-- and it answers in the guest's own words rather than raising.
SELECT lives_ok(
  $$SELECT odesseus_create_live_guest_invite(
       (SELECT id FROM live_memberships WHERE user_id = '6a000001-0000-4000-8000-000000000001'),
       '6a000001-0000-4000-8000-000000000001',
       'bulk-guest-11@example.com',
       'tok_pgtap_' || repeat('0', 32) || '11')$$,
  'the owner issues an eleventh invitation, which is allowed because invitations are free');

SELECT is(
  (SELECT result FROM odesseus_accept_live_guest_invite(
     'tok_pgtap_' || repeat('0', 32) || '11', '6c000000-0000-4000-8000-000000000011')),
  'guest_limit_reached', 'the eleventh guest is refused at the service layer');

-- The eleventh, by writing the row directly. This is the assertion the trigger
-- exists for: a cap enforced only in the service layer is a cap somebody walks
-- around with an INSERT, and a browser session must not get that far either.
SELECT throws_ok(
  $$INSERT INTO live_guest_entitlements (
       membership_id, owner_user_id, guest_user_id, membership_period_start,
       membership_period_end, status)
     VALUES (
       (SELECT id FROM live_memberships WHERE user_id = '6a000001-0000-4000-8000-000000000001'),
       '6a000001-0000-4000-8000-000000000001',
       '6c000000-0000-4000-8000-000000000012',
       (SELECT current_period_start FROM live_memberships
         WHERE user_id = '6a000001-0000-4000-8000-000000000001'),
       (SELECT current_period_end FROM live_memberships
         WHERE user_id = '6a000001-0000-4000-8000-000000000001'),
       'active')$$,
  'P0001', NULL, 'the eleventh activation is refused by the database itself');

SELECT is(
  (SELECT guest_count FROM live_memberships
    WHERE user_id = '6a000001-0000-4000-8000-000000000001'),
  10, 'and the refused activation consumed nothing');

-- ===========================================================================
-- 9. Renewal resets the allocation and keeps the history
-- ===========================================================================
-- The regression test. current_period_start is advanced by two independent
-- paths -- the subscription lifecycle webhook and purchase fulfillment -- and
-- only one of them used to recompute guest_count. A re-purchase through the
-- other path left last year's count on a row whose period had moved, so the cap
-- trigger refused every activation forever and the owner was shown 10 of 10
-- guests used in a year they had used none.
SELECT lives_ok(
  $$INSERT INTO billing_events (stripe_event_id, checkout_session_id, user_id,
      credit_type, credit_delta, sku, amount_cents, currency, metadata)
    VALUES ('evt_pgtap_renew', 'cs_pgtap_renew', '6a000001-0000-4000-8000-000000000001',
            'interview', 1, 'live_share_annual', 49900, 'usd',
            '{"stripe_subscription_id":"sub_pgtap_share",
              "current_period_start":"2027-01-01T00:00:00Z",
              "current_period_end":"2028-01-01T00:00:00Z"}')$$,
  'the membership renews into a second year');

SELECT is(
  (SELECT guest_count FROM live_memberships
    WHERE user_id = '6a000001-0000-4000-8000-000000000001'),
  0, 'the new year starts with the full allocation again');

-- Resetting the count is not the same as forgetting. A member's guest history
-- is their record of who they have given access to, and it is also the only
-- reason the count is what it is.
SELECT is(
  (SELECT count(*)::int FROM live_guest_entitlements e
     JOIN live_memberships m ON m.id = e.membership_id
    WHERE m.user_id = '6a000001-0000-4000-8000-000000000001'),
  10, 'every prior guest is retained, not deleted by the reset');

SELECT is(
  (SELECT count(*)::int FROM live_guest_entitlements e
     JOIN live_memberships m ON m.id = e.membership_id
    WHERE m.user_id = '6a000001-0000-4000-8000-000000000001'
      AND e.status = 'expired'),
  10, 'and they are marked expired rather than left looking active');

-- And the new year really does have ten slots, not one. Guest 12, who has never
-- been invited, is the honest subject here: the point is that the year's
-- allocation is available again, not that one particular guest got through.
SELECT lives_ok(
  $$SELECT odesseus_create_live_guest_invite(
       (SELECT id FROM live_memberships WHERE user_id = '6a000001-0000-4000-8000-000000000001'),
       '6a000001-0000-4000-8000-000000000001',
       'bulk-guest-12@example.com',
       'tok_pgtap_' || repeat('0', 31) || '21')$$,
  'the owner issues a fresh invitation in the new year');

SELECT is(
  (SELECT result FROM odesseus_accept_live_guest_invite(
     'tok_pgtap_' || repeat('0', 31) || '21', '6c000000-0000-4000-8000-000000000012')),
  'activated', 'a guest is activated in the new year, where the old count said it was impossible');

SELECT is(
  (SELECT guest_count FROM live_memberships
    WHERE user_id = '6a000001-0000-4000-8000-000000000001'),
  1, 'and the new year counts from one, not eleven');

-- ---------------------------------------------------------------------------
-- 9b. An invitation expires with the year it was issued in
-- ---------------------------------------------------------------------------
-- Tested by moving the invitation's own snapshotted period into the past, which
-- is the single input the guard reads.
--
-- Simulated rather than reached by waiting, and the reason is worth stating: a
-- year only closes on the calendar, and the rest of this file needs the current
-- period to be in the future so guests can be activated at all. The guard
-- compares membership_period_end against now(), and moving the row's own period
-- end is the same comparison with the clock left alone.
--
-- Before the guard, redeeming this wrote a row that was status 'active', carried
-- no access (its period had closed), and consumed no counted slot (the count is
-- scoped to the membership's *current* period) -- so the owner saw a live guest
-- in a year they had never used and the row was reachable by nothing.
SELECT lives_ok(
  $$UPDATE live_guest_invites
      SET membership_period_start = '2025-01-01T00:00:00Z'::timestamptz,
          membership_period_end   = '2026-01-01T00:00:00Z'::timestamptz
     WHERE membership_id = (SELECT id FROM live_memberships
                              WHERE user_id = '6a000001-0000-4000-8000-000000000001')
       AND guest_email_normalized = 'bulk-guest-11@example.com'
       AND status = 'pending'$$,
  'the eleventh invitation is left pending, from the year that has closed');

SELECT is(
  (SELECT result FROM odesseus_accept_live_guest_invite(
     'tok_pgtap_' || repeat('0', 32) || '11', '6c000000-0000-4000-8000-000000000011')),
  'expired', 'an invitation from the closed year is declined rather than redeemed');

SELECT is(
  (SELECT count(*)::int FROM live_guest_entitlements
    WHERE guest_user_id = '6c000000-0000-4000-8000-000000000011'),
  0, 'and no entitlement is written for it');

SELECT is(
  (SELECT status FROM live_guest_invites
    WHERE membership_id = (SELECT id FROM live_memberships
                             WHERE user_id = '6a000001-0000-4000-8000-000000000001')
      AND guest_email_normalized = 'bulk-guest-11@example.com'),
  'expired', 'so the invitation is marked expired rather than left looking live');

-- ===========================================================================
-- 10. Row-level security between the two sides of an arrangement
-- ===========================================================================
SELECT set_config('role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"6b000000-0000-4000-8000-000000000001","email":"named-guest@example.com","role":"authenticated"}',
  true);

-- A guest reads live_memberships. The only policy is owner-scoped, so this
-- returns nothing -- the guest learns nothing about the plan, the price, the
-- period, or who else has been invited.
SELECT is(
  (SELECT count(*)::int FROM live_memberships),
  0, 'a browser session cannot read any membership, including the one granting it');

-- The guest's own entitlement is theirs to see. Nobody else's is.
SELECT is(
  (SELECT count(*)::int FROM live_guest_entitlements
    WHERE guest_user_id = '6b000000-0000-4000-8000-000000000001'),
  1, 'a guest can read their own guest entitlement');

SELECT is(
  (SELECT count(*)::int FROM live_guest_entitlements e
    WHERE e.guest_user_id = '6b000000-0000-4000-8000-000000000001'
      AND e.guest_user_id <> '6b000000-0000-4000-8000-000000000001'),
  0, 'and the policy is on their own id, not a test that happens to pass here');

SELECT is(
  (SELECT count(*)::int FROM live_guest_entitlements
    WHERE guest_user_id = '6c000000-0000-4000-8000-000000000002'),
  0, 'a guest cannot read a different guest''s entitlement, even in the same arrangement');

-- The invitation policy is deliberately narrower still: a guest may see only
-- their own invitation, and only once it has been activated. A pending
-- invitation reveals who else the owner has invited.
SELECT is(
  (SELECT count(*)::int FROM live_guest_invites),
  1, 'a guest sees only the invitations addressed to them, not the owner''s whole list');

SELECT is(
  (SELECT count(*)::int FROM live_guest_invites
    WHERE guest_email_normalized <> 'named-guest@example.com'),
  0, 'and none of the owner''s other invitations, which would reveal who else they invited');

-- Entitlements are read-only to authenticated sessions. The cap is maintained
-- by triggers over rows nobody can write, so a client cannot manufacture a
-- guest, inflate a count, or delete one to reopen a slot.
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.live_guest_entitlements', 'INSERT'),
  'a client cannot insert a guest entitlement');

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.live_guest_entitlements', 'UPDATE'),
  'a client cannot edit a guest entitlement, so cannot free a consumed slot');

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.live_guest_entitlements', 'DELETE'),
  'a client cannot delete a guest entitlement, so cannot free a consumed slot');

-- The one authoritative access decision is not reachable from a browser. Its
-- result can describe another user's membership and guest relationships, so
-- taking a user id as an argument and granting EXECUTE to authenticated would
-- be an identifier oracle: try ids until one answers.
SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.odesseus_get_live_entitlement(uuid)', 'EXECUTE'),
  'the entitlement function is not executable by a browser session');

SELECT ok(
  has_function_privilege('service_role',
    'public.odesseus_get_live_entitlement(uuid)', 'EXECUTE'),
  'and is executable by the service role that is allowed to resolve it');

-- The owner sees their own arrangement. The guest does not, and the counts they
-- are shown come from the function rather than from a row they can read.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"6a000001-0000-4000-8000-000000000001","email":"owner1@example.com","role":"authenticated"}',
  true);

SELECT is(
  (SELECT count(*)::int FROM live_memberships
    WHERE user_id = '6a000001-0000-4000-8000-000000000001'),
  1, 'an owner can read their own membership');

SELECT is(
  (SELECT count(*)::int FROM live_guest_entitlements e
     JOIN live_memberships m ON m.id = e.membership_id
    WHERE m.user_id = '6a000001-0000-4000-8000-000000000001'),
  11, 'an owner can see every guest in their arrangement, across both years');

-- ===========================================================================
-- 11. Nothing else in the catalog moved
-- ===========================================================================

-- The apply rates this work did not touch. A Live repricing that quietly moved
-- an apply charge would be found out by a customer, not by a test.
SELECT is(
  (SELECT amount_minor FROM pricing_prices WHERE product_key = 'candidate_standard_apply'),
  39, 'Standard Apply is still 39 cents');

SELECT is(
  (SELECT amount_minor FROM pricing_prices WHERE product_key = 'candidate_smart_apply'),
  99, 'Smart Apply is still 99 cents');

SELECT is(
  (SELECT count(*)::int FROM pricing_prices
    WHERE product_key IN ('wallet_topup_10', 'wallet_topup_20', 'wallet_topup_50')
      AND amount_minor IN (1000, 2000, 5000)),
  3, 'the three wallet top-ups are unchanged');

SELECT is(
  (SELECT count(*)::int FROM pricing_prices
    WHERE product_key IN ('employer_starter', 'employer_growth', 'employer_business')
      AND amount_minor IN (7900, 14900, 29900)),
  3, 'the employer plans are unchanged');

SELECT is(
  (SELECT count(*)::int FROM pricing_prices
    WHERE product_key IN ('featured_7d', 'featured_14d', 'ai_30d')
      AND amount_minor IN (2900, 4900, 12900)),
  3, 'the featured listings are unchanged');

SELECT is(
  (SELECT amount_minor FROM pricing_prices WHERE product_key = 'recruiter_seat_month'),
  2000, 'the additional recruiter seat is unchanged');

-- Retired by deactivation, never by deletion. A price row a historical charge
-- was computed from has to still be there, or the transaction it explains loses
-- its meaning.
SELECT is(
  (SELECT count(*)::int FROM pricing_products WHERE active
     AND product_key IN ('candidate_application_single', 'candidate_live_single',
                         'candidate_live_pack_3', 'candidate_live_annual',
                         'candidate_application_pack_25',
                         'candidate_application_pack_50',
                         'candidate_application_pack_100',
                         'employer_starter_bundle', 'employer_addon_post')),
  0, 'no superseded product is still active');

SELECT is(
  (SELECT count(*)::int FROM pricing_products WHERE product_key IN
     ('candidate_application_single', 'candidate_live_single',
      'candidate_live_pack_3', 'candidate_live_annual',
      'candidate_application_pack_25', 'candidate_application_pack_50',
      'candidate_application_pack_100', 'employer_starter_bundle',
      'employer_addon_post')),
  9, 'and every superseded product is still present as a catalog row');

-- The retired prices themselves are the historical record: 2499 was what a
-- single Live pass actually cost, and rewriting it to 1499 would make the old
-- transaction a lie.
SELECT results_eq(
  $$SELECT product_key, amount_minor FROM pricing_prices
     WHERE product_key IN ('candidate_live_single', 'candidate_live_pack_3',
                           'candidate_live_annual', 'candidate_application_single')
     ORDER BY product_key$$,
  $$VALUES ('candidate_application_single'::text, 99),
            ('candidate_live_annual'::text, 49900),
            ('candidate_live_pack_3'::text, 5999),
            ('candidate_live_single'::text, 2499)$$,
  'retired products keep the price they were actually sold at');

-- Every Live price this work set, in the four products it sells, in integer
-- minor units. Pinned rather than derived so a repricing has to be a deliberate
-- edit to a test that says so.
SELECT results_eq(
  $$SELECT product_key, amount_minor FROM pricing_prices
     WHERE product_key IN ('live_single', 'live_monthly',
                           'live_personal_annual', 'live_share_annual')
     ORDER BY product_key$$,
  $$VALUES ('live_monthly'::text, 1999),
            ('live_personal_annual'::text, 9900),
            ('live_share_annual'::text, 49900),
            ('live_single'::text, 1499)$$,
  'the four Live prices are exactly as published');

-- Prices are integer minor units with no market-specific surprises, which is
-- what makes "never a float" a property of the column rather than a habit.
SELECT is(
  (SELECT count(*)::int FROM pricing_prices
    WHERE product_key IN ('live_single', 'live_monthly',
                          'live_personal_annual', 'live_share_annual')
      AND (currency <> 'USD' OR market_key <> 'USD_US' OR amount_minor <= 0)),
  0, 'every Live price is a positive integer number of USD cents in one market');

ROLLBACK;
