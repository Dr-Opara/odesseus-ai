-- Live session polish (Phase 2N). Comment-only corrections, additive.
--
-- odesseus_live_session_is_in_flight's COMMENT claimed "prepared through
-- recovering", but the predicate body, the TypeScript mirror
-- (LIVE_SESSION_IN_FLIGHT in src/lib/live/session-status.ts), and every
-- current writer agree on ready/starting/active/recovering: `prepared` is a
-- legacy pre-consent state no writer produces anymore (prepare now delegates
-- to odesseus_create_live_session, which mints ready/payment_required).
-- The comments are corrected to match the enforced behavior. No function
-- body, constraint, index, or policy is touched.

COMMENT ON FUNCTION public.odesseus_live_session_is_in_flight(text) IS
  'True while a Live session is not yet finished: ready through recovering, i.e. it may still become or be an active session. False for prepared (legacy pre-consent state), payment_required, completed, failed, expired, and ended.';

COMMENT ON FUNCTION public.odesseus_check_live_rate_limit(uuid, integer, integer) IS
  'Rate limit for Live session creation. Counts every session in flight (ready..recovering) plus completed ones inside the window, so repeated prepare-and-fail attempts cannot slip past the ceiling.';

-- End of 20261032000000_live_polish.sql
