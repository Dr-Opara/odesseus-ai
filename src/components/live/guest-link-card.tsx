"use client";

import { useCallback, useState } from "react";

/**
 * Owner-side Guest Live Access Link generation (F12).
 *
 * Available to a Share Annual owner. The owner mints a link and shares it
 * manually — there is no invitation email, no recipient list, and no guest
 * account. That is the whole product model, and the UI below is the entire
 * surface: one button, the resulting link, and a copy affordance.
 *
 * What this component deliberately does not do:
 *
 *  - **It never renders a Live price.** Share Annual is a private, auth-gated
 *    plan; the pricing lives in `@/lib/billing/catalog` and is kept out of the
 *    public pricing module on purpose. This card is only ever rendered behind
 *    an authenticated owner check, and even then it says "included with your
 *    plan" rather than quoting a figure.
 *  - **It never puts the owner id in the URL.** The minted link contains only
 *    the 256-bit random token the server returned. The owner id is never
 *    needed client-side and is never read here, so it cannot leak into a
 *    copied link, a browser history entry, or a screenshot.
 *  - **It does not store the link.** The token is returned exactly once by the
 *    server; the component holds it in memory for the copy affordance and drops
 *    it on navigation. Persisting it would create a second copy of a
 *    credential whose only stored form should be a hash.
 *
 * States are the four the server can actually produce: ready, generating,
 * minted, not entitled, and failed. A 403 is shown as "not available on your
 * plan" rather than as an error, because that is the true answer and it is not
 * something retrying will change.
 */

export type LinkState =
  | { kind: "ready" }
  | { kind: "generating" }
  | { kind: "minted"; url: string }
  | { kind: "not-entitled" }
  | { kind: "failed"; message: string };

/**
 * Turns the mint response into a state.
 *
 * Pure and exported so the decision is testable without a browser. The 403 case
 * is the one that matters: "your plan does not include this" is the true
 * answer, not a transient failure, and showing it as an error would invite a
 * retry that cannot succeed. It is also the answer a lapsed Share Annual owner
 * gets, so it must be the same answer in both cases.
 */
export function classifyMint(
  response: { ok: boolean; status: number },
  payload: { token?: string; error?: string } | null
): LinkState {
  if (response.status === 403) {
    return { kind: "not-entitled" };
  }
  if (!response.ok || !payload?.token) {
    return {
      kind: "failed",
      message: payload?.error ?? "Odesseus could not create that guest link.",
    };
  }
  return { kind: "minted", url: guestLinkUrl(payload.token) };
}

/** Turns a token into the link a guest opens. */
export function guestLinkUrl(token: string): string {
  if (typeof window === "undefined") return `/guest-live/${token}`;
  return `${window.location.origin}/guest-live/${token}`;
}

/**
 * Creates a link and reports what happened.
 *
 * Separated from the component so the state machine above is the only place
 * that interprets a response, and so a network failure lands in the same
 * vocabulary as a server refusal.
 */
export async function requestGuestLink(): Promise<LinkState> {
  try {
    const response = await fetch("/api/live/guest-links", { method: "POST" });
    const payload = (await response.json().catch(() => null)) as {
      token?: string;
      error?: string;
    } | null;
    return classifyMint(response, payload);
  } catch {
    return {
      kind: "failed",
      message: "Odesseus could not reach the server. Please try again.",
    };
  }
}

export default function GuestLinkCard({ canCreateLinks }: { canCreateLinks: boolean }) {
  const [state, setState] = useState<LinkState>(
    canCreateLinks ? { kind: "ready" } : { kind: "not-entitled" }
  );
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    setState({ kind: "generating" });
    setCopied(false);
    setState(await requestGuestLink());
  }, []);

  const copy = useCallback(async () => {
    if (state.kind !== "minted") return;
    try {
      await navigator.clipboard.writeText(state.url);
      setCopied(true);
    } catch {
      // Clipboard access is refused in some browsers and in any non-secure
      // context. The link is on screen and selectable, so say so rather than
      // reporting a failure that looks like the link is broken.
      setCopied(false);
    }
  }, [state]);

  return (
    <section className="card live-entry-card">
      <div className="live-entry-header">
        <div>
          <div className="badge">Share Annual</div>
          <h2 style={{ fontSize: 24, margin: "8px 0 4px" }}>Guest Live Access</h2>
          <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
            Give someone one interview of private Odesseus Live. They need no
            account and no payment &mdash; just the link.
          </p>
        </div>
      </div>

      <div className="live-boundary-note">
        <strong>The guest provides their own details.</strong>
        <span>
          A guest enters their own name, role, company, and resume. Nothing they
          type is added to your profile, your Resume Hub, or your interview
          history, and you cannot see their session.
        </span>
      </div>

      {state.kind === "minted" ? (
        <div className="live-upcoming-interview" style={{ marginTop: 18 }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
            Guest Live Access Link
          </div>
          <input
            className="input"
            readOnly
            value={state.url}
            aria-label="Guest Live Access Link"
            onFocus={(event) => event.currentTarget.select()}
            style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 13 }}
          />
          <div className="emp-page-actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-primary live-launch-btn"
              onClick={copy}
            >
              {copied ? "Copied" : "Copy Link"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={generate}
            >
              Create another link
            </button>
          </div>
          <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
            Share it however you like. The link stays valid while your plan does,
            and you can create a new one at any time &mdash; each link is
            independent.
          </p>
        </div>
      ) : state.kind === "not-entitled" ? (
        <div className="live-blocked-reason" style={{ marginTop: 18 }}>
          Guest Live links are included with the Share Annual plan.{" "}
          <a href="/billing" className="link">
            View your Live plan
          </a>
        </div>
      ) : state.kind === "failed" ? (
        <div className="live-blocked-reason" style={{ marginTop: 18 }}>
          {state.message}
          <div className="emp-page-actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={generate}
            >
              Try again
            </button>
          </div>
        </div>
      ) : (
        <div className="emp-page-actions" style={{ marginTop: 18 }}>
          <button
            type="button"
            className="btn btn-primary live-launch-btn"
            onClick={generate}
            disabled={state.kind === "generating"}
          >
            {state.kind === "generating"
              ? "Creating link…"
              : "Generate Guest Live Access Link"}
          </button>
        </div>
      )}
    </section>
  );
}
