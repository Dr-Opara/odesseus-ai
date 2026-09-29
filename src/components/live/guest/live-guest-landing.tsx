"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import OdesseusWordmark from "@/components/odesseus-wordmark";
import LiveGuestSetup from "@/components/live/guest/live-guest-setup";
import LiveGuestLauncher from "@/components/live/guest/live-guest-launcher";

/**
 * The Guest Live landing, driven entirely by what the token-scoped validation
 * route reports.
 *
 * The states are the things that can actually be true, kept distinct because
 * they mean different things to the person holding the link:
 *
 *   loading   still asking the server
 *   setup     a valid link that has not been set up yet      -> the form
 *   ready     a valid link that can start Live               -> the engine
 *   ended     a finished session                            -> post-interview
 *   invalid   the token is unknown, malformed, retired, or the owner's plan
 *             lapsed. One message on purpose: the server answers all of those
 *             identically, so this page cannot be used to probe which tokens
 *             once existed.
 *   failed    the server could not answer. Retryable, and says so.
 *
 * There is no login, no signup, and no password anywhere on this surface. A
 * guest has no account by design, so offering a sign-in form would be asking
 * for something they do not have and cannot get.
 *
 * Nothing about the token is displayed, logged, or derived here. It is passed
 * straight through to the token-scoped routes, and only what those return is
 * rendered.
 */

type LinkState =
  | { kind: "loading" }
  | { kind: "setup" }
  // Carries the guest's own name so the heading can show whose interview this
  // is. It is the name the guest typed, not the owner's, and it is null until
  // they have supplied one.
  | { kind: "ready"; guestName: string | null }
  | { kind: "ended" }
  | { kind: "invalid"; message: string }
  | { kind: "failed"; message: string };

type Validation = {
  valid: boolean;
  status: string;
  setupComplete: boolean;
  guestName: string | null;
  hasSession: boolean;
};

const INVALID_MESSAGE =
  "This guest link is not valid. Ask for a new link from the person who shared it.";

const SERVER_MESSAGE =
  "Odesseus could not check this link. Check your connection and try again.";

/**
 * Statuses that genuinely mean "this link will not work".
 *
 * 403 and 404 are the only two `loadGuestAccess` produces, and both carry the
 * same message (`GUEST_LINK_UNAVAILABLE`) precisely so this page cannot be used
 * to probe which tokens once existed. A 5xx or a 429 is deliberately not here: a
 * server that could not answer knows nothing about the token, and calling that
 * "invalid" would tell a guest their link is dead when it is not. A guest has no
 * account and cannot ask the owner for a new one on the spot, so a false "this
 * link is over" is a dead end with no way back.
 */
const DEAD_LINK_STATUSES = new Set([403, 404]);

/**
 * Turns a validation response into a state.
 *
 * Pure, and deliberately separate from the fetch: this is the whole decision
 * about what a guest is shown, so it can be read and tested without a network
 * or a component.
 */
function classifyLink(
  response: Response,
  payload: (Validation & { error?: string }) | null
): LinkState {
  if (!response.ok) {
    if (DEAD_LINK_STATUSES.has(response.status)) {
      return { kind: "invalid", message: payload?.error ?? INVALID_MESSAGE };
    }
    // 401 is not possible here (no login exists) and 429 is the per-IP throttle.
    // Both are "try again", not "this link is over".
    return { kind: "failed", message: SERVER_MESSAGE };
  }
  if (!payload?.valid) {
    return { kind: "invalid", message: INVALID_MESSAGE };
  }
  if (payload.status === "completed") {
    return { kind: "ended" };
  }
  // A started session and a saved setup both mean Live can be launched.
  if (payload.hasSession || payload.setupComplete) {
    return { kind: "ready", guestName: payload.guestName ?? null };
  }
  return { kind: "setup" };
}

/** The single network read. Returns a state; never touches React state. */
export async function fetchLinkState(token: string): Promise<LinkState> {
  try {
    const response = await fetch(
      `/api/live/guest-access/${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    const payload = (await response.json().catch(() => null)) as
      | (Validation & { error?: string })
      | null;
    return classifyLink(response, payload);
  } catch {
    return { kind: "failed", message: SERVER_MESSAGE };
  }
}

export default function LiveGuestLanding({ token }: { token: string }) {
  const [state, setState] = useState<LinkState>({ kind: "loading" });

  // Mount only. The initial state is already `loading`, so there is nothing to
  // reset, and the result arrives in a promise callback rather than through a
  // synchronous setState in the effect body.
  useEffect(() => {
    let cancelled = false;
    fetchLinkState(token).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  /** Re-checks the link after a user action, showing the loading state again. */
  const revalidate = useCallback(async () => {
    setState({ kind: "loading" });
    setState(await fetchLinkState(token));
  }, [token]);

  const showBoundaryNote =
    state.kind === "setup" || state.kind === "ready" || state.kind === "ended";

  return (
    // The same container and heading block the applicant Live page uses
    // (src/app/interviews/[id]/live/page.tsx), so the guest sits in the Live
    // visual system rather than a parallel one. The full shell width matters:
    // the workspace lays out its own two-column grid and would be cramped in a
    // narrow measure, so the narrow measure is applied per state below.
    <main className="shell" style={{ padding: "36px 0 90px" }}>
      <div className="live-page-heading">
        <div>
          <OdesseusWordmark href="/" size="sm" />

          <div className="badge" style={{ marginTop: 16 }}>
            Odesseus Live
          </div>

          <h1 style={{ fontSize: 42, letterSpacing: "-0.05em", margin: "14px 0 6px" }}>
            Live interview assistance
          </h1>
        </div>

        {/* The guest's own name, once they have given one. Never the owner's:
            this column is the same right-aligned meta block the applicant page
            uses, holding the same kind of thing -- who this interview is for. */}
        {state.kind === "ready" && state.guestName ? (
          <div className="live-meeting-meta">
            <span>{state.guestName}</span>
            <span className="muted">Guest access</span>
          </div>
        ) : null}
      </div>

        {state.kind === "loading" ? (
          <p className="muted" role="status" aria-live="polite">
            Checking your link…
          </p>
        ) : null}

        {/*
          The Live workspace gets the full shell width because it lays out its
          own two-column grid. Every other state is reading or a form, and
          those want the narrower measure -- so the constraint is applied here
          rather than on the page, which would squash the workspace.
        */}
        {state.kind !== "ready" ? (
          <div style={{ width: "min(720px,100%)" }}>
            {state.kind === "invalid" ? (
              <section className="card post-empty-card" style={{ marginTop: 24 }}>
                <div className="badge">Link not available</div>
                <h2 style={{ fontSize: 28, margin: "16px 0 8px" }}>
                  This link is no longer active.
                </h2>
                <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
                  {state.message}
                </p>
              </section>
            ) : null}

            {state.kind === "failed" ? (
              <section className="card post-empty-card" style={{ marginTop: 24 }}>
                <div className="badge">Connection problem</div>
                <h2 style={{ fontSize: 28, margin: "16px 0 8px" }}>
                  Odesseus could not check this link.
                </h2>
                <p className="muted" style={{ margin: "0 0 18px", lineHeight: 1.6 }}>
                  {state.message}
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void revalidate()}
                >
                  Try again
                </button>
              </section>
            ) : null}

            {state.kind === "setup" ? (
              <>
                <p className="muted" style={{ fontSize: 18, lineHeight: 1.6 }}>
                  Set up your interview. Everything you enter stays with this link
                  &mdash; there is no account to create.
                </p>
                <LiveGuestSetup token={token} onSaved={() => void revalidate()} />
              </>
            ) : null}

            {state.kind === "ended" ? (
              <section className="card post-empty-card" style={{ marginTop: 24 }}>
                <div className="badge">Session complete</div>
                <h2 style={{ fontSize: 28, margin: "16px 0 8px" }}>
                  Your interview has ended.
                </h2>
                <p className="muted" style={{ margin: "0 0 18px", lineHeight: 1.6 }}>
                  Your post-interview summary is available on this link.
                </p>
                <Link
                  className="btn btn-primary"
                  href={`/guest-live/${encodeURIComponent(token)}/analysis`}
                >
                  View post-interview analysis
                </Link>
              </section>
            ) : null}

            {state.kind !== "loading" ? (
              <div className="live-boundary-note" style={{ marginTop: 32 }}>
                <strong>You remain the interviewee.</strong>
                <span>
                  Odesseus listens only after you start it, shows private on-screen
                  guidance, and never joins the meeting or speaks for you.
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {state.kind === "ready" ? (
          <LiveGuestLauncher
            token={token}
            guestName={state.guestName}
            onEnded={() => void revalidate()}
          />
        ) : null}
    </main>
  );
}
