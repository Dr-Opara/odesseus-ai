"use client";

import { useMemo, useSyncExternalStore } from "react";
import OdesseusLiveClient from "@/components/odesseus-live-client";
import { guestLiveTransport } from "@/lib/interviews/guest-transport";

/**
 * The guest's Live workspace (F12).
 *
 * This component contains no Live logic at all. It builds a token-scoped
 * transport and hands the unmodified `OdesseusLiveClient` to it, so the guest
 * gets the same engine an applicant gets: the same state machine, the same
 * WebRTC negotiation, the same guidance rendering, the same timer, the same
 * recovery behaviour, and the same visual system. A second copy of the engine
 * would be a second product that drifts, and this is how it is avoided.
 *
 * What differs is only where the five session calls go, and that difference is
 * entirely inside the transport.
 *
 * The token is captured once and never rendered, never logged, and never put
 * anywhere except the request paths the transport builds.
 */
export default function LiveGuestLauncher({
  token,
  guestName,
  onEnded,
}: {
  token: string;
  /** The guest's own name, for the meeting-meta block. Never the owner's. */
  guestName: string | null;
  onEnded: () => void;
}) {
  const transport = useMemo(() => guestLiveTransport(token), [token]);
  const narrow = useNarrowViewport();
  const analysisUrl = `/guest-live/${encodeURIComponent(token)}/analysis`;
  const landingUrl = `/guest-live/${encodeURIComponent(token)}`;

  return (
    <>
      <div className="live-boundary-note" style={{ marginTop: 22 }}>
        <strong>Consent comes first.</strong>
        <span>
          Odesseus starts listening only when you press start, and it never
          records without your explicit permission. You stay the speaker.
        </span>
      </div>

      {/*
        Odesseus Live is a desktop experience, stated on the mobile Live screen
        as well. A guest is the most likely person to open this link on a phone
        -- an interview is often minutes away -- so saying so here beats letting
        them grant microphone permission and then fail to connect. Detection is
        render-time and purely advisory: the engine itself is unchanged, and a
        narrow window or an unusual UA does not disable the product.
      */}
      {narrow ? (
        <div className="live-boundary-note" style={{ marginTop: 22 }}>
          <strong>Odesseus Live needs a larger screen.</strong>
          <span>
            Open this link on a laptop or desktop computer to run the interview
            session. You can set up and read your analysis here.
          </span>
        </div>
      ) : null}

      <OdesseusLiveClient
        interviewId={token}
        // A guest has no account, no wallet, and no passes. The session is
        // covered by the link owner's plan, and that is enforced server-side
        // when the session activates -- so the gate is "covered", and no
        // invented pass count is displayed or required.
        entitlement={{ kind: "included" }}
        transport={transport}
        afterEndUrl={analysisUrl}
        onEnded={onEnded}
        // Both buttons stay inside the guest's own link. The engine's defaults
        // point at applicant pages, and following one would land a guest on a
        // login screen -- the one thing a guest with no account must never see.
        links={{
          analysis: analysisUrl,
          workspace: landingUrl,
          workspaceLabel: "Back to Guest Live",
        }}
      />
    </>
  );
}

/** Below this width the engine's two-column layout has nowhere to go. */
const MIN_LIVE_WIDTH = 900;

function readNarrowViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < MIN_LIVE_WIDTH;
}

/**
 * Tracks whether the viewport is too small for the Live workspace.
 *
 * The engine lays out two columns and needs a keyboard-height surface, so below
 * this width it is unusable. A guest is the person most likely to open this link
 * on a phone -- the interview is often minutes away -- so saying so beats
 * letting them grant microphone permission and then fail to connect.
 *
 * `useSyncExternalStore` rather than an effect plus `useState`: the viewport is
 * an external store, this is the primitive built for it, and it renders
 * correctly on the server instead of flashing a desktop warning at a phone on
 * first paint. The subscription also means a tablet in a dock, a phone
 * rotated, or a window dragged onto a second display all cross the boundary
 * without a reload.
 *
 * Advisory only. The engine is rendered either way and is unchanged; a narrow
 * window or an unusual user agent does not disable the product, it only warns.
 */
function useNarrowViewport(): boolean {
  return useSyncExternalStore(subscribeToResize, readNarrowViewport, () => false);
}

function subscribeToResize(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}
