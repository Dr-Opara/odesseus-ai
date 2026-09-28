-- Live interview session status domain (additive constraint correction).
--
-- live_interview_sessions.status carried the original four-value CHECK from
-- the v0.11 baseline:
--
--   status IN ('prepared', 'active', 'ended', 'failed')
--
-- but the shipped Live lifecycle moved well past that model. The deployed
-- SQL functions and the TypeScript routes write and read six more statuses,
-- so the constraint was rejecting writes the product has been making since
-- 20261011000001:
--
--   ready              odesseus_create_live_session creates a session here
--                      once an entitlement exists. This is the *common* path:
--                      without it, creating a Live session raises a CHECK
--                      violation and Odesseus Live cannot start at all.
--   payment_required   odesseus_create_live_session, when there is no
--                      entitlement; and odesseus_activate_live_session_v2,
--                      when entitlement was lost between prepare and activate.
--   starting           odesseus_activate_live_session_v2, the transient state
--                      while the realtime connection is being established.
--   completed          odesseus_complete_live_session (the normal end).
--   expired            odesseus_expire_live_session, and
--                      odesseus_cleanup_stale_live_sessions for a session that
--                      was never activated and has aged out.
--
-- Two more are in the domain because live code depends on them even though
-- nothing currently writes them, and removing them would make that code dead:
--
--   recovering         accepted as a prior state by
--                      odesseus_recover_live_session, odesseus_complete_live_session,
--                      odesseus_fail_live_session, odesseus_expire_live_session,
--                      odesseus_check_live_rate_limit, and
--                      odesseus_activate_live_session_v2. The constraint must
--                      agree with the runtime model, not contradict it, so the
--                      value is reserved rather than dropped.
--   ended              written by odesseus_end_live_session, which is still a
--                      live public function, and read by
--                      /api/interviews/[id]/live/prepare to refuse a session
--                      that has already ended.
--
-- Nothing is invented here: every value is either written by code in this
-- repository or read by code in this repository. The set is the union of
-- what the lifecycle can produce and what the lifecycle accepts.
--
-- No historical row is touched. The new domain is a strict superset of the old
-- one, so every row that satisfied the old constraint still satisfies the new
-- one and the ALTER cannot fail on existing data. There is no backfill,
-- no UPDATE, and no status rewrite: a past session keeps the status it really
-- had. supabase/tests/live-session-status-domain.test.sql asserts that.

ALTER TABLE public.live_interview_sessions
  DROP CONSTRAINT IF EXISTS live_interview_sessions_status_check;

ALTER TABLE public.live_interview_sessions
  ADD CONSTRAINT live_interview_sessions_status_check
  CHECK (
    status IN (
      'prepared',
      'ready',
      'payment_required',
      'starting',
      'active',
      'recovering',
      'completed',
      'failed',
      'expired',
      'ended'
    )
  );

COMMENT ON CONSTRAINT live_interview_sessions_status_check ON public.live_interview_sessions IS
  'The live session lifecycle: prepared -> ready -> starting -> active -> completed, with payment_required when there is no entitlement, recovering for a reconnect, failed for a start/runtime error, expired for a session that aged out unused, and ended for the legacy end path. Every value is written or accepted by a function in this schema; the union is the authoritative domain and src/lib/live/session-status.ts mirrors it.';

-- The per-user hold-queue style read ("what is this user's Live session right
-- now") filters on status and orders by recency. The baseline had no index
-- covering the status values the lifecycle now actually produces, so the
-- candidate-facing Live page and the admin session browser both scanned.
CREATE INDEX IF NOT EXISTS live_interview_sessions_status_created_idx
  ON public.live_interview_sessions (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Active-state reporting.
--
-- Four separate call sites each had to restate "is this session still going?"
-- as their own status list, and odesseus_check_live_rate_limit counted a third
-- variant. Those lists already disagreed with each other. One function keeps
-- the notion in a single place, so a new status cannot be added to the
-- lifecycle while being forgotten by the readers.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.odesseus_live_session_is_in_flight(p_status text)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  AS $function$
  SELECT p_status IN ('ready', 'starting', 'active', 'recovering');
$function$;

COMMENT ON FUNCTION public.odesseus_live_session_is_in_flight(text) IS
  'True while a Live session is not yet finished: prepared through recovering, i.e. it may still become or be an active session. False for payment_required, completed, failed, expired, and ended.';

REVOKE ALL ON FUNCTION public.odesseus_live_session_is_in_flight(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_live_session_is_in_flight(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.odesseus_live_session_is_in_flight(text) TO postgres, service_role;

-- odesseus_check_live_rate_limit counted ('active', 'completed', 'recovering')
-- and nothing else, so a user could open unlimited concurrent sessions by
-- letting each prepare+fail before the next: every one of those rows was
-- invisible to the rate limit. It now counts everything in flight using the
-- shared predicate, which is the set that was actually intended.
--
-- The completed case is preserved deliberately: a completed session is not in
-- flight, but it is still a real Live session in the window and must count
-- against the ceiling.
CREATE OR REPLACE FUNCTION public.odesseus_check_live_rate_limit (
  p_user_id        uuid,
  p_window_minutes integer DEFAULT 60,
  p_max_sessions   integer DEFAULT 3
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_count integer;
  v_cutoff timestamptz := now() - (p_window_minutes || ' minutes')::interval;
begin
  select count(*)
  into v_count
  from public.live_interview_sessions
  where user_id = p_user_id
    and created_at >= v_cutoff
    and (public.odesseus_live_session_is_in_flight(status) or status = 'completed');

  if v_count >= p_max_sessions then
    return false;
  end if;

  return true;
end;
$function$;

COMMENT ON FUNCTION public.odesseus_check_live_rate_limit(uuid, integer, integer) IS
  'Rate limit for Live session creation. Counts every session in flight (prepared..recovering) plus completed ones inside the window, so repeated prepare-and-fail attempts cannot slip past the ceiling.';

REVOKE ALL ON FUNCTION public.odesseus_check_live_rate_limit(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_check_live_rate_limit(uuid, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_check_live_rate_limit(uuid, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_check_live_rate_limit(uuid, integer, integer) TO postgres, service_role;
