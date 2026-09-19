export type LiveClientState = "idle" | "connecting" | "live" | "ending" | "ended" | "error";

// Retrying after a failed start must not be blocked by an idle-only gate:
// the "Start Odysseus Live" / "Try again" button renders in both "idle" and
// "error", so whether a click actually starts a connection attempt must
// agree with that, or the button silently does nothing after a failure.
export function canStartLive(
  state: LiveClientState,
  consent: boolean,
  interviewPasses: number
) {
  return consent && interviewPasses > 0 && (state === "idle" || state === "error");
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
