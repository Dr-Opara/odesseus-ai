/**
 * The authoritative Odesseus Live session status domain.
 *
 * This list is the TypeScript half of a two-sided contract. The other half is
 * the `live_interview_sessions_status_check` constraint added in migration
 * 20261025000000. Both are derived from the same evidence: every value below is
 * either written by a lifecycle function in this schema
 * (`odesseus_create_live_session`, `odesseus_activate_live_session_v2`,
 * `odesseus_recover_live_session`, `odesseus_complete_live_session`,
 * `odesseus_fail_live_session`, `odesseus_expire_live_session`,
 * `odesseus_cleanup_stale_live_sessions`, `odesseus_end_live_session`) or
 * accepted as a prior state by one of them.
 *
 * The baseline table shipped a four-value CHECK while the lifecycle already
 * produced six more, which meant creating a Live session raised a CHECK
 * violation. Keeping the list here, next to the code that reads the value,
 * means a lifecycle change has to touch one list and the compiler catches the
 * callers that would otherwise keep comparing against a status that can no
 * longer exist.
 *
 * The lifecycle, in plain terms:
 *
 *   prepared           created by /api/interviews/[id]/live/prepare before
 *                      consent is confirmed
 *   ready              an entitlement exists and the session can be activated
 *   payment_required   created or demoted when there is no entitlement
 *   starting           the realtime connection is being established
 *   active             the candidate is in a live interview
 *   recovering         a reconnect to the same active session
 *   completed          the interview ended normally
 *   failed             a start or runtime error
 *   expired            aged out unused, or explicitly expired
 *   ended              the legacy end path, still a live function
 */
export const LIVE_SESSION_STATUSES = [
  "prepared",
  "ready",
  "payment_required",
  "starting",
  "active",
  "recovering",
  "completed",
  "failed",
  "expired",
  "ended",
] as const;

export type LiveSessionStatus = (typeof LIVE_SESSION_STATUSES)[number];

/** True when the database will accept `value` for live_interview_sessions.status. */
export function isLiveSessionStatus(value: unknown): value is LiveSessionStatus {
  return (
    typeof value === "string" && (LIVE_SESSION_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Statuses from which a session can still become, or already is, an active
 * interview. Mirrors `odesseus_live_session_is_in_flight(text)`.
 *
 * `payment_required` is deliberately excluded: it is a dead end until the
 * candidate buys access, so treating it as in flight would make a session that
 * can never start look like a live one.
 */
export const LIVE_SESSION_IN_FLIGHT: readonly LiveSessionStatus[] = [
  "ready",
  "starting",
  "active",
  "recovering",
];

/** Statuses that mean the session is over. Nothing moves on from these. */
export const LIVE_SESSION_TERMINAL: readonly LiveSessionStatus[] = [
  "completed",
  "failed",
  "expired",
  "ended",
];

export function isLiveSessionInFlight(status: LiveSessionStatus): boolean {
  return LIVE_SESSION_IN_FLIGHT.includes(status);
}

export function isLiveSessionTerminal(status: LiveSessionStatus): boolean {
  return LIVE_SESSION_TERMINAL.includes(status);
}

/**
 * Statuses a candidate must not be able to restart or be charged for again.
 *
 * This is the set that means "the pass was spent or the attempt is over".
 * `payment_required` is included because no pass was ever consumed for it,
 * while `failed` is included because a session that failed *after* activation
 * has already had its entitlement consumed and must not be re-consumed.
 */
export function isLiveSessionSpentPass(status: LiveSessionStatus): boolean {
  return (
    status === "payment_required" ||
    status === "completed" ||
    status === "failed" ||
    status === "expired" ||
    status === "ended"
  );
}
