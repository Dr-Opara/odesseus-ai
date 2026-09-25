-- Stripe webhook delivery observability (M10). Additive migration; local stack.
--
-- The audit's P2 "Stripe fulfillment monitoring" item is currently a blind
-- spot: the webhook only records successful candidate checkouts to
-- billing_events, so rejected, errored, and ignored deliveries leave no
-- trace. This migration lands a server-side-only delivery log:
--
--   1. public.webhook_events — an append-only log of every webhook delivery
--      that reached a terminal outcome: which Stripe event (nullable for
--      unparseable/invalid-signature deliveries), what happened (ignored /
--      rejected / fulfilled / errored / duplicate), the HTTP status we
--      returned, the known user/org/sku context, and a free-form reason.
--      Browser roles can never see or write it: the table is RLS-denied and
--      carries no anon/authenticated privileges (the M9 hardening pattern).
--   2. public.odesseus_log_webhook_event() — a service-role-only
--      SECURITY DEFINER RPC that records one delivery. It fails closed on
--      unknown outcomes and out-of-range HTTP statuses, so a coding mistake
--      in the route can never write garbage into the log. Returns the row id.
--
-- Invariants preserved: additive-only; RLS extended, never weakened; every
-- delivery outcome is recorded but the money path (billing_events grants,
-- employer/org syncs, featured listings) is completely untouched; the log is
-- not unique-keyed because Stripe replays the same event id for retries and
-- each delivery attempt is worth its own row.
--
-- Invariants preserved: RLS never weakened; candidate wallet, apply
-- settlement, employer billing, and Live pricing untouched; the resumes
-- bucket policies untouched.

-- ---------------------------------------------------------------------------
-- 1. public.webhook_events
-- ---------------------------------------------------------------------------

CREATE TABLE public.webhook_events (
  id                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  stripe_event_id     text,
  event_type          text,
  outcome             text                     NOT NULL,
  http_status         smallint                 NOT NULL,
  user_id             uuid,
  org_id              uuid,
  sku                 text,
  checkout_session_id text,
  reason              text,
  details             jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT webhook_events_pkey PRIMARY KEY (id),
  CONSTRAINT webhook_events_outcome_check CHECK (
    outcome IN ('received', 'rejected', 'fulfilled', 'errored', 'duplicate', 'ignored')),
  CONSTRAINT webhook_events_http_status_check CHECK (http_status BETWEEN 200 AND 599),
  CONSTRAINT webhook_events_reason_length_check CHECK (reason IS NULL OR char_length(reason) <= 500)
);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.webhook_events
  ADD CONSTRAINT webhook_events_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX webhook_events_stripe_event_id_idx ON public.webhook_events (stripe_event_id);
CREATE INDEX webhook_events_created_at_idx ON public.webhook_events (created_at DESC);
CREATE INDEX webhook_events_outcome_idx ON public.webhook_events (outcome);

COMMENT ON TABLE public.webhook_events IS
  'Server-only log of Stripe webhook deliveries and their terminal outcome. RLS deny-browser-access + no anon/authenticated grants.';
COMMENT ON COLUMN public.webhook_events.outcome IS
  'ignored = acked, nothing to do; rejected = fail-closed 4xx; fulfilled = money path completed; errored = 5xx; duplicate = already-processed replay';

-- RLS: this log is server-side only. A single deny policy for both browser
-- roles is the second, independent layer behind the privilege-level REVOKE
-- below: even if a future migration re-grants privileges, RLS still returns
-- zero rows for anon/authenticated.
CREATE POLICY "webhook_events_deny_browser_access" ON public.webhook_events
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- Supabase default-grants ALL to anon/authenticated on freshly created
-- tables; the deny policy would already stop row access, but the privilege
-- surface must match the server-only posture (M9 audit hardening).
REVOKE ALL ON TABLE public.webhook_events FROM anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.webhook_events TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 2. Delivery logging (service role only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.odesseus_log_webhook_event (
  p_stripe_event_id text,
  p_event_type      text,
  p_outcome         text,
  p_http_status     integer,
  p_user_id         uuid DEFAULT NULL,
  p_org_id          uuid DEFAULT NULL,
  p_sku             text DEFAULT NULL,
  p_checkout_session_id text DEFAULT NULL,
  p_reason          text DEFAULT NULL,
  p_details         jsonb DEFAULT '{}'::jsonb
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_id uuid;
begin
  if p_outcome not in ('received', 'rejected', 'fulfilled', 'errored', 'duplicate', 'ignored') then
    raise exception 'unknown webhook outcome: %', p_outcome;
  end if;

  if p_http_status is null or p_http_status < 200 or p_http_status > 599 then
    raise exception 'webhook http_status out of range: %', p_http_status;
  end if;

  insert into public.webhook_events (
    stripe_event_id,
    event_type,
    outcome,
    http_status,
    user_id,
    org_id,
    sku,
    checkout_session_id,
    reason,
    details)
  values (
    p_stripe_event_id,
    p_event_type,
    p_outcome,
    p_http_status,
    p_user_id,
    p_org_id,
    p_sku,
    p_checkout_session_id,
    p_reason,
    coalesce(p_details, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_log_webhook_event(text, text, text, integer, uuid, uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_log_webhook_event(text, text, text, integer, uuid, uuid, text, text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_log_webhook_event(text, text, text, integer, uuid, uuid, text, text, text, jsonb) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.odesseus_log_webhook_event(text, text, text, integer, uuid, uuid, text, text, text, jsonb) TO postgres, service_role;