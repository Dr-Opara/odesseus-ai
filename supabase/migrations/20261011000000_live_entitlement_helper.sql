-- Live entitlement helper function (Phase 7A). Additive migration.
--
-- This migration creates the entitlement helper function first, so it's
-- available for subsequent migrations that depend on it.

-- ---------------------------------------------------------------------------
-- 1. Entitlement status helper (computed, not stored)
-- ---------------------------------------------------------------------------
-- Rather than adding a column, we expose a function that computes the
-- entitlement state for a user. This avoids write skew and keeps the
-- logic in one place. Uses OUT parameters so callers can use
-- SELECT ... INTO directly.

CREATE OR REPLACE FUNCTION public.odesseus_get_live_entitlement (
  p_user_id uuid,
  OUT has_entitlement boolean,
  OUT entitlement_type text,
  OUT passes_remaining integer,
  OUT unlimited_until timestamptz,
  OUT fair_use_count integer,
  OUT fair_use_reset timestamptz
)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_balances public.credit_balances%rowtype;
  v_now timestamptz := now();
  v_fair_use_count integer;
  v_fair_use_reset timestamptz;
begin
  select *
  into v_balances
  from public.credit_balances
  where user_id = p_user_id;

  if not found then
    has_entitlement := false;
    entitlement_type := 'none';
    passes_remaining := 0;
    unlimited_until := null;
    fair_use_count := 0;
    fair_use_reset := v_now;
    return;
  end if;

  -- Fair use window: rolling 30 days
  v_fair_use_reset := v_now - interval '30 days';

  select count(*)
  into v_fair_use_count
  from public.live_interview_sessions
  where user_id = p_user_id
    and activated_at >= v_fair_use_reset
    and status in ('active', 'completed');

  -- Annual unlimited entitlement
  if v_balances.live_unlimited_until is not null and v_balances.live_unlimited_until > v_now then
    has_entitlement := true;
    entitlement_type := 'annual';
    passes_remaining := 0;
    unlimited_until := v_balances.live_unlimited_until;
    fair_use_count := v_fair_use_count;
    fair_use_reset := v_fair_use_reset + interval '30 days';
    return;
  end if;

  -- Discrete passes
  if v_balances.interview_passes > 0 then
    has_entitlement := true;
    entitlement_type := 'passes';
    passes_remaining := v_balances.interview_passes;
    unlimited_until := null;
    fair_use_count := 0;
    fair_use_reset := v_fair_use_reset + interval '30 days';
    return;
  end if;

  has_entitlement := false;
  entitlement_type := 'none';
  passes_remaining := 0;
  unlimited_until := null;
  fair_use_count := 0;
  fair_use_reset := v_fair_use_reset + interval '30 days';
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_get_live_entitlement(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_get_live_entitlement(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_get_live_entitlement(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_get_live_entitlement(uuid) TO postgres, service_role;