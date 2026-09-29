export type LiveClientState = "idle" | "connecting" | "live" | "ending" | "ended" | "error";

/**
 * Why Live can be started, and what the screen should say about it.
 *
 * Two real situations, not one number:
 *
 *   passes    An applicant spending their own interview passes. The count is
 *             real and is displayed, and starting is blocked at zero.
 *   included  A guest whose session is covered by the link owner's plan. There
 *             is no pass, no count, and no balance to show — the guest has no
             account at all. Starting is allowed, and the entitlement itself is
 *             enforced server-side when the session activates.
 *
 * The previous design passed a raw `interviewPasses: number` and required
 * `> 0`. A guest therefore had to be given either a fabricated pass count or a
 * permanently disabled Start button. Both are wrong: one invents an entitlement
 * the guest does not have, the other makes the product unusable. Modelling the
 * situation instead of the number is what lets one engine serve both honestly.
 */
export type LiveEntitlementGate =
  | { kind: "passes"; available: number }
  | { kind: "included" };

/** Whether this session may be started right now. */
export function hasLiveEntitlement(gate: LiveEntitlementGate): boolean {
  return gate.kind === "included" || gate.available > 0;
}

// Retrying after a failed start must not be blocked by an idle-only gate:
// the "Start Odesseus Live" / "Try again" button renders in both "idle" and
// "error", so whether a click actually starts a connection attempt must
// agree with that, or the button silently does nothing after a failure.
export function canStartLive(
  state: LiveClientState,
  consent: boolean,
  gate: LiveEntitlementGate
) {
  return consent && hasLiveEntitlement(gate) && (state === "idle" || state === "error");
}

// Assigns a stable order to items based on when each was FIRST observed
// (e.g. a transcript item's first delta), not when it happens to complete.
// Realtime completion events are not guaranteed to arrive in chronological
// order, and concurrent network requests are not guaranteed to resolve in
// dispatch order either, so display/storage order must not be derived
// from arrival order.
export function createTurnSequencer() {
  const sequence: Record<string, number> = {};
  let next = 0;

  return {
    turnIndexFor(itemId: string): number {
      if (sequence[itemId] === undefined) {
        sequence[itemId] = next++;
      }
      return sequence[itemId];
    },
    peek(itemId: string): number | undefined {
      return sequence[itemId];
    },
  };
}
