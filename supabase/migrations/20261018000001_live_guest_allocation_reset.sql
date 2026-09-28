-- Live Share guest allocation must reset when the membership year rolls over.
--
-- The defect
-- ----------
-- `live_memberships.guest_count` is the number the cap is read from: the
-- BEFORE INSERT trigger on live_guest_entitlements refuses an activation once
-- `guest_count >= guest_limit`, and odesseus_get_live_entitlement reports
-- `guest_count` straight to the owner as `activated_guest_count`.
--
-- It was kept correct by one trigger on live_guest_entitlements, which
-- recomputes the count for the membership's *current* period. That is enough to
-- stay right while one path moves the period, but there are two, and only one
-- of them looked after the count:
--
--   * odesseus_sync_live_membership(), driven by the Stripe subscription
--     lifecycle webhook, expires prior-period entitlements and recomputes
--     guest_count in the same call. Correct.
--
--   * odesseus_private.fulfill_billing_event(), driven by an insert into
--     billing_events, upserts live_memberships on (user_id, plan_type) and sets
--     current_period_start and current_period_end from the event metadata. It
--     does not touch guest_count. Correct for a first purchase, where the INSERT
--     branch sets it to 0, and wrong for a re-purchase, where the ON CONFLICT
--     branch leaves last year's count on a row whose period has moved.
--
-- A member who finishes a year at the cap, lets the subscription lapse, and
-- subscribes again is therefore permanently locked out: guest_count is still 10,
-- the cap trigger refuses every activation with "guest limit reached", and the
-- owner is shown 10 of 10 guests used in a year they have used none. Reproduced
-- directly against the database: after a renewal through billing_events, the
-- eleventh distinct guest was refused and activated_guest_count read 10.
--
-- The fix
-- -------
-- Move the invariant to the thing it is an invariant *of*. A trigger on
-- live_memberships that fires whenever current_period_start moves, and resets
-- the allocation to match. One place, both paths, and it cannot be forgotten by
-- a third path added later.
--
-- This does not replace the existing trigger on live_guest_entitlements, which
-- is still what keeps the count right as entitlements are added, revoked, and
-- expired one at a time. It adds the one transition that trigger is not watching
-- for.
--
-- Additive: a new function and a new trigger. No existing function, table,
-- column, or policy is changed, and no entitlement row is deleted -- prior
-- periods are marked expired, exactly as odesseus_sync_live_membership already
-- does, so a member's history stays readable and the rows remain the reason the
-- count is what it is.

BEGIN;

-- ---------------------------------------------------------------------------
-- The reset, on the transition that needs it
-- ---------------------------------------------------------------------------
--
-- Written as a recompute rather than a reset to zero on purpose. Right after a
-- period rolls over the correct count is zero, but if a membership is created
-- already mid-period, or the period start is corrected backwards, the count has
-- to be whatever the entitlements actually say. Deriving it means this trigger
-- and the entitlement trigger can never disagree about the same row.

CREATE OR REPLACE FUNCTION odesseus_private.live_membership_guest_allocation_reset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- A status-only update, or a re-write of the same period, is not a rollover.
  -- The trigger is declared UPDATE OF current_period_start, so this also
  -- short-circuits the recursive update below, which does not name the column.
  IF new.current_period_start IS NOT DISTINCT FROM old.current_period_start THEN
    RETURN new;
  END IF;

  -- Plans with no guest capacity have no allocation to reset, and the
  -- live_memberships_personal_has_no_guests check keeps their count at 0.
  IF new.guest_limit < 1 THEN
    RETURN new;
  END IF;

  -- Prior periods stop counting. The period filter below already excludes them;
  -- this is the status bookkeeping that keeps an admin listing of past guests
  -- honest, and it matches what odesseus_sync_live_membership does.
  UPDATE public.live_guest_entitlements
  SET status = 'expired',
      updated_at = now()
  WHERE membership_id = new.id
    AND status = 'active'
    AND (new.current_period_start IS NULL
         OR membership_period_start < new.current_period_start);

  UPDATE public.live_memberships m
  SET guest_count = (
        SELECT count(*)::int
        FROM public.live_guest_entitlements e
        WHERE e.membership_id = m.id
          AND e.status = 'active'
          AND m.current_period_start IS NOT NULL
          AND e.membership_period_start = m.current_period_start
      ),
      updated_at = now()
  WHERE m.id = new.id;

  RETURN new;
END;
$$;

COMMENT ON FUNCTION odesseus_private.live_membership_guest_allocation_reset() IS
  'Resets the Live Share guest allocation when a membership period rolls over. '
  'Exists because current_period_start is advanced by two independent paths -- '
  'odesseus_sync_live_membership for subscription lifecycle webhooks and '
  'odesseus_private.fulfill_billing_event for purchases -- and a re-purchase '
  'that reached the latter used to leave the previous year''s guest_count on a '
  'row whose period had moved, permanently refusing new activations.';

DROP TRIGGER IF EXISTS live_memberships_guest_allocation_reset ON public.live_memberships;

CREATE TRIGGER live_memberships_guest_allocation_reset
AFTER UPDATE OF current_period_start ON public.live_memberships
FOR EACH ROW
EXECUTE FUNCTION odesseus_private.live_membership_guest_allocation_reset();

COMMIT;
