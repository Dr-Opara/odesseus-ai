"use client";

import { useCallback, useState } from "react";
import { requestGuestLink, type LinkState } from "./guest-link-card";

/**
 * The mobile action for minting a Guest Live Access Link.
 *
 * The desktop card and this button share one state machine: `classifyMint` and
 * `requestGuestLink` in `./guest-link-card` decide what happened, and both
 * surfaces render that decision. Two implementations of "the server said no"
 * would drift, and the one that drifted would be the one a plan-lapsed owner
 * met.
 *
 * The link is shown in full and selectable rather than behind a copy-only
 * button. A phone browser may refuse clipboard access in a non-secure context,
 * and a Share Annual owner who cannot copy the link has no way to share it.
 */
export default function GuestLinkButton() {
  const [state, setState] = useState<LinkState>({ kind: "ready" });
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
      setCopied(false);
    }
  }, [state]);

  if (state.kind === "minted") {
    return (
      <div className="m-card" style={{ marginTop: 12 }}>
        <span className="m-copy">
          <strong>Guest Live Access Link</strong>
          <input
            className="input"
            readOnly
            value={state.url}
            aria-label="Guest Live Access Link"
            onFocus={(event) => event.currentTarget.select()}
            style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 12 }}
          />
        </span>
        <div className="emp-page-actions" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={copy}
          >
            {copied ? "Copied" : "Copy Link"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={generate}
          >
            New link
          </button>
        </div>
      </div>
    );
  }

  if (state.kind === "not-entitled") {
    return (
      <div className="m-card" style={{ marginTop: 12, opacity: 0.7 }}>
        <span className="m-copy">
          <strong>Not available on your plan</strong>
          <small>Guest Live links come with Share Annual.</small>
        </span>
      </div>
    );
  }

  if (state.kind === "failed") {
    return (
      <div className="m-card" style={{ marginTop: 12 }}>
        <span className="m-copy">
          <strong>Could not create the link</strong>
          <small>{state.message}</small>
        </span>
        <div className="emp-page-actions" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={generate}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="emp-page-actions" style={{ marginTop: 12 }}>
      <button
        type="button"
        className="m-action"
        onClick={generate}
        disabled={state.kind === "generating"}
        style={{ display: "block", width: "100%", textAlign: "center", textDecoration: "none" }}
      >
        {state.kind === "generating" ? "Creating link…" : "Generate Guest Live Access Link"}
      </button>
    </div>
  );
}
