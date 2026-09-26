-- Seat quantity synchronization on member removal (M5 follow-up).
-- Additive migration; local stack.
--
-- M5 let a member be removed, which freed seat *capacity* immediately because
-- capacity is derived live from employer_members. What it did not do was stop
-- Stripe charging for the removed seat. That leaves an employer paying $20/month
-- for a teammate who no longer exists, with nothing in the product showing why.
--
-- This migration adds the billing side:
--
--   1. public.employer_seat_adjustments -- an audit row per synchronization
--      attempt, with a UNIQUE idempotency_key. The key is derived from
--      (org, removed member, target quantity) so a retried or duplicated
--      request collides instead of re-issuing the Stripe update. This is a
--      database-level guarantee, not an in-process one, so it holds across
--      concurrent serverless invocations and webhook/API overlap.
--   2. public.odesseus_claim_seat_adjustment() -- inserts the claim and
--      returns false on conflict, so the caller can skip the Stripe call
--      without a read-then-write race.
--   3. public.odesseus_finish_seat_adjustment() -- records the terminal
--      outcome. On failure it CLEARS the idempotency key so a later retry can
--      claim the same adjustment; PostgreSQL permits many NULLs in a unique
--      index, which is exactly the semantics needed.
--
-- The target quantity is never tracked as a counter. It is always recomputed
-- from the roster by odesseus_org_required_seat_count(), so recomputing yields
-- the same answer however many times it runs. An increment/decrement counter
-- could not offer that.
--
-- Invariants preserved: additive-only; no data dropped or rewritten;
-- recruiter_seats, employer_members, employer_organizations and their RLS and
-- grants are untouched -- this migration only READS the roster. Candidate
-- wallet, apply settlement, employer plan quotas, featured listings, and Live
-- pricing are unaffected. The money path is still exclusively webhook-driven:
-- this table records what we asked Stripe to do, it never grants a seat.

-- ---------------------------------------------------------------------------
-- 1. public.employer_seat_adjustments
-- ---------------------------------------------------------------------------

CREATE TABLE public.employer_seat_adjustments (
  id                     uuid                     NOT NULL DEFAULT gen_random_uuid(),
  org_id                 uuid                     NOT NULL,
  stripe_subscription_id text,
  removed_user_id        uuid,
  previous_quantity      integer,
  new_quantity           integer                  NOT NULL CHECK (new_quantity >= 0),
  outcome                text                     NOT NULL DEFAULT 'pending'::text,
  -- Deterministic per (org, removed member, target). A duplicate request for
  -- the same adjustment cannot insert a second claim.
  idempotency_key        text                     UNIQUE,
  error                  text,
  created_at             timestamp with time zone NOT NULL DEFAULT now(),
  updated_at             timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT employer_seat_adjustments_pkey PRIMARY KEY (id),
  -- 'skipped_no_subscription' means the org has no live paid seat
  -- subscription, so there is nothing to resize.
  CONSTRAINT employer_seat_adjustments_outcome_check CHECK (
    outcome IN (
      'pending',
      'updated',
      'cancelled_at_period_end',
      'no_change',
      'skipped_no_subscription',
      'failed')),
  CONSTRAINT employer_seat_adjustments_quantity_check CHECK (
    previous_quantity IS NULL OR previous_quantity >= 0)
);

ALTER TABLE public.employer_seat_adjustments ENABLE ROW LEVEL SECURITY;

-- Deny-by-default policy. Second, independent layer behind the REVOKE below: if
-- a future migration re-grants a privilege, RLS still returns no rows.
CREATE POLICY "employer_seat_adjustments_deny_browser_access"
  ON public.employer_seat_adjustments
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.employer_seat_adjustments FROM anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.employer_seat_adjustments TO postgres, service_role;

ALTER TABLE public.employer_seat_adjustments
  ADD CONSTRAINT employer_seat_adjustments_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.employer_organizations(id) ON DELETE CASCADE;

CREATE INDEX employer_seat_adjustments_org_idx
  ON public.employer_seat_adjustments (org_id, created_at DESC);
CREATE INDEX employer_seat_adjustments_outcome_idx
  ON public.employer_seat_adjustments (outcome);

COMMENT ON TABLE public.employer_seat_adjustments IS
  'Audit of every attempt to synchronize a Stripe recruiter-seat subscription quantity with the employer team roster, triggered by a member removal. Service-role only. Records what we asked Stripe to do; it never grants a seat -- entitlements still come exclusively from the money-verified webhook path.';
COMMENT ON COLUMN public.employer_seat_adjustments.idempotency_key IS
  'Deterministic per (org_id, removed_user_id, new_quantity). The unique constraint is the duplicate-execution guard: a retried request collides instead of re-issuing the Stripe update. Cleared to NULL on failure so a later retry can re-claim.';
COMMENT ON COLUMN public.employer_seat_adjustments.outcome IS
  'pending while the Stripe call is in flight; then exactly one terminal value. cancelled_at_period_end means the last seat was removed and the subscription is scheduled to lapse at the end of the paid period rather than being cut short.';

-- ---------------------------------------------------------------------------
-- 2. Claim a synchronization attempt
-- ---------------------------------------------------------------------------

-- Returns false (rather than raising) on conflict so the caller can skip the
-- Stripe call as a normal, expected outcome rather than an error.
CREATE OR REPLACE FUNCTION public.odesseus_claim_seat_adjustment (
  p_idempotency_key        text,
  p_org_id                 uuid,
  p_new_quantity           integer,
  p_removed_user_id        uuid DEFAULT NULL,
  p_stripe_subscription_id text    DEFAULT NULL,
  p_previous_quantity      integer DEFAULT NULL
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'invalid seat adjustment idempotency key';
  end if;

  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'invalid target seat quantity: %', p_new_quantity;
  end if;

  insert into public.employer_seat_adjustments
    (idempotency_key, org_id, new_quantity, removed_user_id,
     stripe_subscription_id, previous_quantity, outcome)
  values
    (trim(p_idempotency_key), p_org_id, p_new_quantity, p_removed_user_id,
     p_stripe_subscription_id, p_previous_quantity, 'pending')
  on conflict (idempotency_key) do nothing;

  return found;
end;
$function$;

COMMENT ON FUNCTION public.odesseus_claim_seat_adjustment(text, uuid, integer, uuid, text, integer) IS
  'Claims a seat-quantity synchronization attempt, returning false when an identical attempt is already recorded. The UNIQUE idempotency_key makes duplicate execution a no-op at the database level rather than an in-process check that two concurrent invocations could both pass.';

REVOKE ALL ON FUNCTION public.odesseus_claim_seat_adjustment(text, uuid, integer, uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_claim_seat_adjustment(text, uuid, integer, uuid, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_claim_seat_adjustment(text, uuid, integer, uuid, text, integer) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.odesseus_claim_seat_adjustment(text, uuid, integer, uuid, text, integer) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 3. Record the terminal outcome
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.odesseus_finish_seat_adjustment (
  p_idempotency_key text,
  p_outcome         text,
  p_error           text DEFAULT NULL
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_id uuid;
begin
  if p_outcome not in (
       'updated', 'cancelled_at_period_end', 'no_change',
       'skipped_no_subscription', 'failed') then
    raise exception 'unknown seat adjustment outcome: %', p_outcome;
  end if;

  update public.employer_seat_adjustments
     set outcome         = p_outcome,
         error           = nullif(left(coalesce(p_error, ''), 500), ''),
         -- A failed attempt must be retryable, so its claim is released.
         -- PostgreSQL allows many NULLs in a unique index, so clearing the key
         -- lets a later run claim the same adjustment again.
         idempotency_key = case when p_outcome = 'failed' then null else idempotency_key end,
         updated_at      = now()
   where idempotency_key = trim(p_idempotency_key)
  returning id into v_id;

  if v_id is null then
    raise exception 'seat adjustment claim not found: %', p_idempotency_key;
  end if;
end;
$function$;

COMMENT ON FUNCTION public.odesseus_finish_seat_adjustment(text, text, text) IS
  'Records the terminal outcome of a claimed seat-quantity synchronization. A ''failed'' outcome releases the idempotency claim so the adjustment can be retried; a successful outcome keeps it, so a duplicate request stays a no-op.';

REVOKE ALL ON FUNCTION public.odesseus_finish_seat_adjustment(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_finish_seat_adjustment(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_finish_seat_adjustment(text, text, text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.odesseus_finish_seat_adjustment(text, text, text) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 4. Support reading an org's live seat subscription
-- ---------------------------------------------------------------------------
--
-- The removal route needs the Stripe subscription id and its current quantity
-- in order to resize it. recruiter_seats is readable by org members (SELECT
-- behind RLS) and written only by the webhook, so the sync reads it through a
-- SECURITY DEFINER function rather than adding a service-role table read to
-- the route. Keeping the "what counts as a live seat" rule in one place is the
-- same reason getSeatSummary uses odesseus_org_live_seat_count.

CREATE OR REPLACE FUNCTION public.odesseus_org_live_seat_subscription (p_org_id uuid)
  RETURNS TABLE (
    seat_count            integer,
    active_until          timestamp with time zone,
    stripe_subscription_id text,
    stripe_customer_id    text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
  select
    rs.count::integer,
    rs.active_until,
    rs.stripe_subscription_id,
    rs.stripe_customer_id
  from public.recruiter_seats rs
  where rs.org_id = p_org_id
    and rs.count > 0
    and (rs.active_until is null or rs.active_until > now())
  order by rs.active_until desc nulls last, rs.updated_at desc
  limit 1;
$function$;

COMMENT ON FUNCTION public.odesseus_org_live_seat_subscription(uuid) IS
  'The org''s single live paid seat entitlement: its seat count, paid period end, and the Stripe identifiers needed to resize it. Returns no rows when the org has no live paid seats. SECURITY DEFINER because recruiter_seats is webhook-written; it is service-role only, since a Stripe subscription id is not something a team member needs.';

REVOKE ALL ON FUNCTION public.odesseus_org_live_seat_subscription(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_org_live_seat_subscription(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_org_live_seat_subscription(uuid) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.odesseus_org_live_seat_subscription(uuid) TO postgres, service_role;
