"use client";

import { useCallback, useEffect, useState } from "react";
import OdesseusLiveClient from "@/components/odesseus-live-client";
import GuestSetupForm from "@/components/guest-setup-form";
import GuestPostInterviewResult from "@/components/guest-post-interview-result";
import { guestLiveEndpoints } from "@/lib/live/endpoints";
import {
  createGuestPostAnalysis,
  readGuestLink,
  readGuestSession,
  type GuestSessionState,
} from "@/lib/live/guest-share";

type Resolved = {
  state: "loading" | "invalid" | "setup" | "ready" | "ended";
  reason: string;
  guestName: string | null;
  session: GuestSessionState | null;
};

const LOADING: Resolved = { state: "loading", reason: "", guestName: null, session: null };

async function resolveGuestState(token: string): Promise<Resolved> {
  const link = await readGuestLink(token);
  if (!link.valid) {
    return {
      state: "invalid",
      reason: link.reason ?? "This guest link is not valid.",
      guestName: null,
      session: null,
    };
  }
  if (!link.setupComplete) {
    return { state: "setup", reason: "", guestName: link.guestName, session: null };
  }
  const session = await readGuestSession(token);
  const ended = session?.status === "ended" || session?.status === "completed";
  return { state: ended ? "ended" : "ready", reason: "", guestName: link.guestName, session };
}

/**
 * Guest Live flow (F2): validate the link, capture the guest's own interview
 * context, then launch the SAME Odesseus Live workspace applicants use. There
 * is no second Live engine here — only the token-scoped routes differ, and
 * they are supplied through `guestLiveEndpoints`.
 *
 * `reloadToken` is a manual-refresh key: the link state is re-read after setup
 * and after a session ends, rather than being pushed down by an effect.
 */
export default function GuestLiveShell({ token }: { token: string }) {
  const [resolved, setResolved] = useState<Resolved>(LOADING);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    void resolveGuestState(token).then((next) => {
      if (!cancelled) setResolved(next);
    });
    return () => {
      cancelled = true;
    };
  }, [token, reloadToken]);

  const { state, reason, guestName, session } = resolved;

  if (state === "loading") {
    return (
      <div className="card" style={{ padding: 32 }}>
        <div className="badge">Odesseus Live</div>
        <h1 style={{ fontSize: 32, margin: "16px 0 8px" }}>Checking your link…</h1>
        <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
          One moment while we open your guest session.
        </p>
      </div>
    );
  }

  if (state === "invalid") {
    return (
      <div className="card" style={{ padding: 32 }}>
        <h1 style={{ fontSize: 32, margin: "0 0 10px" }}>This link can&rsquo;t be used.</h1>
        <p className="muted" style={{ lineHeight: 1.6, margin: 0 }}>
          {reason}
        </p>
      </div>
    );
  }

  if (state === "setup") {
    return <GuestSetupForm token={token} onComplete={reload} />;
  }

  if (state === "ended") {
    return (
      <>
        <div className="card" style={{ padding: 32 }}>
          <div className="badge">Odesseus Live</div>
          <h1 style={{ fontSize: 32, margin: "16px 0 8px" }}>Interview completed</h1>
          <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
            {guestName ? `Thanks, ${guestName}. ` : ""}Your Live session has ended and the
            transcript was saved with this guest session only.
          </p>
        </div>
        <GuestPostInterviewResult
          token={token}
          transcriptTurns={session?.transcriptItems?.length ?? 0}
          guidanceItems={session?.guidanceItems ?? []}
          onRefresh={reload}
        />
      </>
    );
  }

  return (
    <>
      <div className="live-page-heading" style={{ marginBottom: 18 }}>
        <div>
          <div className="badge">Odesseus Live · Guest</div>
          <h1 style={{ fontSize: 36, letterSpacing: "-0.05em", margin: "12px 0 6px" }}>
            Your guest interview session
          </h1>
          <p className="muted" style={{ margin: 0 }}>
            {guestName ? `Signed in for this session as ${guestName}.` : "Signed in for this session."}{" "}
            No account, no payment, nothing to install.
          </p>
        </div>
      </div>

      <div className="live-boundary-note">
        <strong>You remain the speaker.</strong>
        <span>
          Odesseus listens only after you start it, shows private on-screen guidance, and
          never joins the meeting or speaks for you.
        </span>
      </div>

      <OdesseusLiveClient
        interviewId={token}
        interviewPasses={1}
        endpoints={guestLiveEndpoints(token)}
        requiresPass={false}
        passNote={{
          title: "Covered by your host's link",
          detail: "Nothing further is charged to you. The session is yours to use.",
        }}
        endedFooter={
          <button type="button" className="btn btn-secondary" style={{ marginTop: 10 }} onClick={reload}>
            View interview result
          </button>
        }
      />

      {session && session.transcriptItems && session.transcriptItems.length > 0 ? (
        <section className="card live-transcript-card" style={{ marginTop: 20 }}>
          <div className="muted" style={{ fontSize: 13 }}>
            Saved transcript
          </div>
          <div className="live-transcript-list">
            {session.transcriptItems.map((item) => (
              <div className="live-transcript-item" key={item.id}>
                {item.is_question ? <div className="badge">Question</div> : null}
                <span>{item.transcript}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
