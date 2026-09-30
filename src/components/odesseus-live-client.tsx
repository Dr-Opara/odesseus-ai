"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  canStartLive,
  createTurnSequencer,
  hasLiveEntitlement,
  type LiveEntitlementGate,
} from "@/lib/live/session-state";
import { waitForIceGatheringComplete, waitForPeerConnected } from "@/lib/live/webrtc-timing";
import {
  applicantLiveLinks,
  applicantLiveTransport,
  type LiveNavigationLinks,
  type LiveTransport,
} from "@/lib/live/transport";

type CaptureMode = "microphone" | "shared_audio" | "mixed";
type GuidanceMode = "default" | "star" | "shorter" | "technical" | "follow_up" | "manual";

type Guidance = {
  id?: string;
  mode?: string;
  question_text?: string;
  response_text?: string;
  structure?: string | null;
  verified_evidence?: string[];
  caution?: string | null;
};

type TranscriptItem = {
  itemId: string;
  transcript: string;
  isQuestion: boolean;
  questionText?: string | null;
  turnIndex: number;
};

// How long to keep the data channel open after the candidate stops sending
// new audio, so an in-flight transcription-completed event for whatever
// was already said can still arrive and be persisted before teardown.
const END_DRAIN_MS = 1200;

function extractSessionId(payload: any) {
  return (
    payload?.id ||
    payload?.session?.id ||
    payload?.client_secret?.session?.id ||
    payload?.client_secret?.id ||
    "realtime"
  );
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

async function createCaptureStream(mode: CaptureMode) {
  if (mode === "microphone") {
    return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  }

  const display = await navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: true,
  });

  const displayAudio = display.getAudioTracks()[0];
  const videoTracks = display.getVideoTracks();

  if (!displayAudio) {
    videoTracks.forEach((track) => track.stop());
    display.getTracks().forEach((track) => track.stop());
    throw new Error(
      "No shared audio was provided. Choose a browser tab/window and enable Share audio, or switch to microphone mode."
    );
  }

  videoTracks.forEach((track) => track.stop());

  if (mode === "shared_audio") {
    return new MediaStream([displayAudio]);
  }

  const mic = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false,
  });

  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();

  const displaySource = context.createMediaStreamSource(
    new MediaStream([displayAudio])
  );
  displaySource.connect(destination);

  const micTrack = mic.getAudioTracks()[0];
  if (micTrack) {
    const micSource = context.createMediaStreamSource(
      new MediaStream([micTrack])
    );
    micSource.connect(destination);
  }

  const mixed = new MediaStream(destination.stream.getAudioTracks());

  const stop = () => {
    display.getTracks().forEach((track) => track.stop());
    mic.getTracks().forEach((track) => track.stop());
    mixed.getTracks().forEach((track) => track.stop());
    void context.close().catch(() => undefined);
  };

  mixed.getTracks().forEach((track) => {
    track.addEventListener("ended", stop, { once: true });
  });

  return mixed;
}

export default function OdesseusLiveClient({
  interviewId,
  entitlement,
  transport: providedTransport,
  afterEndUrl,
  onEnded,
  links: providedLinks,
}: {
  interviewId: string;
  /**
   * Why this session may be started, and what the screen says about it.
   *
   * An applicant passes their real remaining pass count. A guest passes
   * `included`, because the session is covered by the link owner's plan and
   * the guest has no account, no balance, and no passes to count.
   */
  entitlement: LiveEntitlementGate;
  /**
   * Where the session calls go. Omit it for the authenticated applicant, which
   * is the default and unchanged behaviour; a guest passes the token-scoped
   * transport instead.
   *
   * This is the only difference between an applicant Live session and a guest
   * one. The state machine below, the WebRTC negotiation, the guidance
   * rendering, the timer, the recovery path, and the whole visual system are
   * identical for both, which is the point: there is one Live engine, and a
   * second copy of this file would be a second product.
   */
  transport?: LiveTransport;
  /**
   * Where to go once the session has ended. Defaults to a refresh, which is
   * right for an applicant whose page re-reads their own session status. A
   * guest passes their own post-interview path.
   */
  afterEndUrl?: string;
  /** Called after a clean end, before any navigation. */
  onEnded?: () => void;
  /**
   * Where the "Analyze interview" and "Back" buttons lead.
   *
   * These are the engine's only applicant-specific strings left, and they are
   * injected rather than derived from `interviewId` so a guest is never offered
   * a link to a page that would send them to a login screen. A guest has no
   * account; the worst outcome for them is clicking "Back" and being asked to
   * create one.
   */
  links?: LiveNavigationLinks;
}) {
  const router = useRouter();
  const transport = useMemo(
    () => providedTransport ?? applicantLiveTransport(interviewId),
    [providedTransport, interviewId]
  );
  const links = useMemo<LiveNavigationLinks>(
    () => providedLinks ?? applicantLiveLinks(interviewId),
    [providedLinks, interviewId]
  );
  /**
   * Ends the session and then either navigates somewhere specific or simply
   * re-reads the current page. One place, so a guest and an applicant cannot
   * drift apart on what "finished" means.
   */
  const finishSession = useCallback(() => {
    onEnded?.();
    if (afterEndUrl) {
      router.push(afterEndUrl);
      return;
    }
    router.refresh();
  }, [onEnded, afterEndUrl, router]);
  const [captureMode, setCaptureMode] = useState<CaptureMode>("shared_audio");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<
    "idle" | "connecting" | "live" | "ending" | "ended" | "error"
  >("idle");
  const [statusText, setStatusText] = useState("Ready when the interview starts.");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  // The last turn was recorded but no guidance came back. Kept apart from
  // "there was nothing to answer" so the panel can say which happened.
  const [guidanceUnavailable, setGuidanceUnavailable] = useState(false);
  const [lastQuestion, setLastQuestion] = useState("");
  const [busyMode, setBusyMode] = useState<GuidanceMode | null>(null);
  const [error, setError] = useState("");
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [sessionDuration, setSessionDuration] = useState(0);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const partialRef = useRef<Record<string, string>>({});
  const manualRequestIdRef = useRef(0);
  const turnSequencerRef = useRef(createTurnSequencer());
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const canStart = canStartLive(state, consent, entitlement);
  const entitled = hasLiveEntitlement(entitlement);

  const modeCopy = useMemo(() => {
    if (captureMode === "shared_audio") {
      return "Best for interviews running in a browser tab. Share the interview tab/window with audio.";
    }
    if (captureMode === "mixed") {
      return "Captures shared interview audio plus your microphone.";
    }
    return "Uses only your microphone. This may not capture the interviewer clearly.";
  }, [captureMode]);

  const turnIndexFor = useCallback(
    (itemId: string) => turnSequencerRef.current.turnIndexFor(itemId),
    []
  );

  // Session timer effect
  useEffect(() => {
    if (state === "live" && sessionStartTime) {
      timerRef.current = setInterval(() => {
        setSessionDuration(Date.now() - sessionStartTime);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [state, sessionStartTime]);

  const saveTranscriptAndGuide = useCallback(
    async (
      sid: string,
      itemId: string,
      transcript: string,
      mode: GuidanceMode = "default",
      forceGuidance = false
    ) => {
      const turnIndex = turnIndexFor(itemId);

      const data = await transport
        .transcript({
          sessionId: sid,
          itemId,
          transcript,
          mode,
          forceGuidance,
          turnIndex,
        })
        .then((result) => result as unknown as Record<string, unknown> & {
          isQuestion?: boolean;
          questionText?: string | null;
          guidance?: Guidance | null;
          guidanceUnavailable?: boolean;
        });

      const item: TranscriptItem = {
        itemId,
        transcript,
        isQuestion: Boolean(data.isQuestion),
        questionText: data.questionText || null,
        turnIndex,
      };

      setTranscripts((current) => {
        const without = current.filter((entry) => entry.itemId !== itemId);
        return [...without, item]
          .sort((a, b) => a.turnIndex - b.turnIndex)
          .slice(-20);
      });

      if (data.guidance) {
        setGuidance(data.guidance);
        setLastQuestion(data.questionText || transcript);
        setGuidanceUnavailable(false);
      } else if (data.guidanceUnavailable) {
        // The turn was recorded; only the answer could not be produced. Say so
        // rather than leaving the panel empty, which reads as "Odesseus has
        // stopped listening" to somebody who is in an interview right now.
        setGuidance(null);
        setLastQuestion(transcript);
        setGuidanceUnavailable(true);
      }

      return data;
    },
    // `transport` is a dependency, not an oversight: it is the only thing that
    // decides where this turn is written, and leaving it out would leave a
    // callback holding the previous transport for the life of the component.
    [transport, turnIndexFor]
  );

  // Takes the prepared session id as an explicit parameter rather than
  // reading it from component state. The data-channel message listener
  // that calls this is registered once, inside startLive(), so a version
  // that closed over the `sessionId` state variable would be permanently
  // frozen at whatever that state held during that one render (typically
  // still null, since setSessionId's update hasn't been re-rendered into
  // scope yet) — silently dropping every transcript for the rest of the
  // session. `sid` here is a plain local value from the same startLive()
  // call, so it can't go stale.
  const handleRealtimeEvent = useCallback(
    async (sid: string, event: any) => {
      const type = String(event?.type || "");
      const itemId = String(
        event?.item_id ||
          event?.item?.id ||
          event?.id ||
          "segment-" + ++manualRequestIdRef.current
      );
      turnIndexFor(itemId);

      if (
        type === "conversation.item.input_audio_transcription.delta" ||
        type === "input_audio_transcription.delta"
      ) {
        partialRef.current[itemId] =
          (partialRef.current[itemId] || "") + String(event?.delta || "");
        return;
      }

      if (
        type === "conversation.item.input_audio_transcription.completed" ||
        type === "input_audio_transcription.completed"
      ) {
        const transcript = String(
          event?.transcript ||
            event?.item?.content?.[0]?.transcript ||
            partialRef.current[itemId] ||
            ""
        ).trim();

        delete partialRef.current[itemId];

        if (!transcript) return;

        try {
          await saveTranscriptAndGuide(sid, itemId, transcript);
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : "Odesseus could not process a transcript segment."
          );
        }
        return;
      }

      if (type === "error") {
        setError(event?.error?.message || "Realtime transcription reported an error.");
      }
    },
    [saveTranscriptAndGuide, turnIndexFor]
  );

  const cleanupConnection = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    channelRef.current?.close();
    peerRef.current?.close();
    streamRef.current = null;
    peerRef.current = null;
    channelRef.current = null;
  }, []);

  // Release any open capture/connection if the user navigates away without
  // explicitly ending the session.
  useEffect(() => {
    return () => {
      cleanupConnection();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [cleanupConnection]);

  async function startLive() {
    if (!canStart) return;

    setState("connecting");
    setError("");
    setStatusText("Requesting audio permission…");

    let stream: MediaStream | null = null;
    let peer: RTCPeerConnection | null = null;
    let dataChannel: RTCDataChannel | null = null;

    try {
      const preparedSessionId = (
        await transport.prepare({ captureMode, consent: true })
      ).sessionId;
      setSessionId(preparedSessionId);

      stream = await createCaptureStream(captureMode);
      streamRef.current = stream;

      peer = new RTCPeerConnection();
      peerRef.current = peer;

      for (const track of stream.getAudioTracks()) {
        peer.addTrack(track, stream);
      }

      dataChannel = peer.createDataChannel("oai-events");
      channelRef.current = dataChannel;

      dataChannel.addEventListener("message", (message) => {
        try {
          const event = JSON.parse(message.data);
          void handleRealtimeEvent(preparedSessionId, event);
        } catch {
          // Ignore non-JSON transport messages.
        }
      });

      dataChannel.addEventListener("open", () => {
        setStatusText("Live transcription connected.");
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      setStatusText("Gathering connection candidates…");
      await waitForIceGatheringComplete(peer);

      // OpenAI's Realtime endpoint does not support trickled ICE, so the
      // offer must carry every candidate gathered above — read the final
      // local description rather than the pre-gathering `offer` object.
      const finalSdp = peer.localDescription?.sdp || offer.sdp;

      // An SDP offer is the entire request body for the realtime exchange, so
      // "no offer" is not something to forward. Previously this fell through to
      // `JSON.stringify`, which silently dropped the undefined field and sent
      // the route a malformed body it would reject with a bare 400. Failing
      // here names the actual problem instead.
      if (!finalSdp) {
        throw new Error(
          "Odesseus could not read the audio connection offer. Please try again."
        );
      }

      setStatusText("Connecting secure transcription…");

      const realtimePayload = await transport.webrtc({
        sessionId: preparedSessionId,
        sdp: finalSdp,
      });

      await peer.setRemoteDescription({
        type: "answer",
        sdp: realtimePayload.sdp,
      });

      setStatusText("Establishing realtime connection…");

      // A successful SDP exchange does not guarantee the connection
      // actually works (ICE/DTLS can still fail on a restrictive
      // network) — do not activate, and do not consume the interview
      // pass, until the peer connection genuinely reaches "connected".
      const connected = await waitForPeerConnected(peer);
      if (!connected) {
        throw new Error(
          "Odesseus could not establish a stable realtime connection. Please try again."
        );
      }

      await transport.activate({
        sessionId: preparedSessionId,
        openaiSessionId: extractSessionId(realtimePayload),
      });

      const startTime = Date.now();
      setSessionStartTime(startTime);
      setSessionDuration(0);
      setState("live");
      setStatusText("Odesseus Live is listening for interview questions.");
      finishSession();
    } catch (err) {
      stream?.getTracks().forEach((track) => track.stop());
      dataChannel?.close();
      peer?.close();
      streamRef.current = null;
      peerRef.current = null;
      channelRef.current = null;
      setState("error");
      setStatusText("Live did not start.");
      setError(
        err instanceof Error ? err.message : "Odesseus Live could not start."
      );
    }
  }

  async function requestMode(mode: GuidanceMode) {
    if (!sessionId || !lastQuestion) return;

    setBusyMode(mode);
    setError("");

    try {
      manualRequestIdRef.current += 1;
      const itemId = `manual-${mode}-${manualRequestIdRef.current}`;
      const data = await saveTranscriptAndGuide(
        sessionId,
        itemId,
        lastQuestion,
        mode,
        true
      );

      if (data?.guidance) setGuidance(data.guidance);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Odesseus could not refresh guidance."
      );
    } finally {
      setBusyMode(null);
    }
  }

  async function endLive() {
    if (!sessionId) return;

    setState("ending");
    setStatusText("Ending Live session…");

    // Stop sending new audio immediately, but keep the data channel and
    // peer connection open during the drain window so a transcription
    // event already in flight for what was just said can still arrive and
    // get persisted — closing the channel here would silently discard it.
    streamRef.current?.getTracks().forEach((track) => {
      track.enabled = false;
    });

    await wait(END_DRAIN_MS);

    cleanupConnection();

    try {
      await transport.end({ sessionId });

      setState("ended");
      setStatusText("Interview ended. Transcript context is ready for analysis.");
      finishSession();
    } catch (err) {
      setState("error");
      setError(
        err instanceof Error ? err.message : "Odesseus could not close the session."
      );
    }
  }

  function retryLive() {
    setState("idle");
    setError("");
    setGuidance(null);
    setLastQuestion("");
    setTranscripts([]);
    setSessionId(null);
    setSessionStartTime(null);
    setSessionDuration(0);
    setStatusText("Ready when the interview starts.");
  }

  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 768;

  return (
    <div className="live-client-grid">
      <section className="card live-control-card">
        <div className="live-control-header">
          <div>
            <div className="muted" style={{ fontSize: 13 }}>
              Audio source
            </div>
            <h2 style={{ fontSize: 24, margin: "7px 0 6px" }}>
              What should Odesseus listen to?
            </h2>
            <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
              {modeCopy}
            </p>
          </div>

          {state === "live" && (
            <div className="live-session-timer" aria-live="polite">
              <span className="timer-label">Session</span>
              <time className="timer-value">{formatDuration(sessionDuration)}</time>
            </div>
          )}
        </div>

        <div className="live-capture-options">
          {[
            ["shared_audio", "Shared interview audio"],
            ["mixed", "Shared audio + microphone"],
            ["microphone", "Microphone only"],
          ].map(([value, label]) => (
            <label className="live-capture-option" key={value}>
              <input
                type="radio"
                name="capture"
                value={value}
                checked={captureMode === value}
                onChange={() => setCaptureMode(value as CaptureMode)}
                disabled={state !== "idle"}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        <label className="live-consent">
          <input
            type="checkbox"
            checked={consent}
            disabled={state !== "idle"}
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>
            I consent to live audio transcription for this interview and confirm I am permitted to use an interview assistant in this setting.
          </span>
        </label>

        <div className="live-pass-note">
          {entitlement.kind === "passes" ? (
            <>
              <strong>
                {entitlement.available} interview pass
                {entitlement.available === 1 ? "" : "es"} available
              </strong>
              <span className="muted">
                No pass is used until the realtime connection successfully
                activates.
              </span>
            </>
          ) : (
            <>
              <strong>Covered by the person who shared this link</strong>
              <span className="muted">
                There is nothing to buy and no account to create. Odesseus
                checks the link is still active when the session connects.
              </span>
            </>
          )}
        </div>

        {error ? <div className="apply-error">{error}</div> : null}

        <div className="live-controls">
          {state === "idle" || state === "error" ? (
            <button
              className="btn btn-primary"
              type="button"
              onClick={state === "error" ? retryLive : startLive}
              disabled={!consent || !entitled}
            >
              {state === "error" ? "Try again" : "Start Odesseus Live"}
            </button>
          ) : null}

          {state === "live" ? (
            <button className="btn btn-secondary" type="button" onClick={endLive}>
              End interview
            </button>
          ) : null}

          {state === "connecting" || state === "ending" ? (
            <span className="muted">Working…</span>
          ) : null}
        </div>

        <div className="live-status-line">
          <span
            className={
              state === "live"
                ? "live-status-dot live-status-dot-active"
                : "live-status-dot"
            }
          />
          <span>{statusText}</span>
        </div>
      </section>

      <section className="card live-guidance-card">
        <div>
          <div className="muted" style={{ fontSize: 13 }}>
            Live guidance
          </div>
          <h2 style={{ fontSize: 24, margin: "7px 0 6px" }}>
            {guidance?.question_text || lastQuestion || "Waiting for a question…"}
          </h2>
        </div>

        {/*
          A refusal has no answer. The coding guard returns only a caution, and
          the point of it is that the person is told rather than left staring at
          an unchanged panel -- so the caution renders on its own, and the
          follow-up actions that only make sense for a real answer stay hidden.
        */}
        {guidance?.response_text ? (
          <>
            <div className="live-answer">{guidance.response_text}</div>

            {guidance.structure ? (
              <div className="live-structure">
                <span className="muted">Structure</span>
                <strong>{guidance.structure}</strong>
              </div>
            ) : null}

            {guidance.verified_evidence?.length ? (
              <div className="live-evidence">
                <span className="muted">Verified evidence</span>
                {guidance.verified_evidence.map((item) => (
                  <div key={item}>✓ {item}</div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {guidance?.caution ? (
          <div className="review-note">{guidance.caution}</div>
        ) : null}

        {guidance?.response_text ? (
          <div className="live-guidance-actions">
            {[
              ["star", "STAR"],
              ["shorter", "Shorter"],
              ["technical", "More technical"],
              ["follow_up", "Follow-up"],
            ].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className="btn btn-secondary"
                onClick={() => requestMode(mode as GuidanceMode)}
                disabled={Boolean(busyMode)}
              >
                {busyMode === mode ? "Working…" : label}
              </button>
            ))}
          </div>
        ) : /*
           Only when nothing at all was said. If there is a caution, the caution
           is the explanation: printing "Odesseus only surfaces guidance when it
           identifies a question" underneath a deliberate refusal would read as
           if Odesseus had merely not understood, which is the opposite of what
           happened.
         */ !guidance ? (
          <div className="live-waiting">
            <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
              {guidanceUnavailable
                ? "Your transcript is being recorded. Odesseus could not prepare a response for that one — keep going."
                : "Odesseus only surfaces guidance when it identifies a question or clear request for you to respond."}
            </p>
          </div>
        ) : null}
      </section>

      <section className="card live-transcript-card">
        <div className="muted" style={{ fontSize: 13 }}>
          Recent transcript
        </div>

        <div className="live-transcript-list">
          {transcripts.length ? (
            [...transcripts].reverse().map((item) => (
              <div className="live-transcript-item" key={item.itemId}>
                {item.isQuestion ? <div className="badge">Question</div> : null}
                <span>{item.transcript}</span>
              </div>
            ))
          ) : (
            <span className="muted">
              Transcript will appear here once Live starts.
            </span>
          )}
        </div>
      </section>

      {state === "ended" && (
        <section className="card live-completed-card">
          <div className="live-completed-icon" aria-hidden="true">✓</div>
          <h2 style={{ fontSize: 28, margin: "10px 0 8px" }}>
            Interview completed
          </h2>
          <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
            The Live session has ended. Your transcript is saved and ready for
            post-interview analysis.
          </p>
          <div className="live-completed-stats">
            <div>
              <strong>{transcripts.length}</strong>
              <span className="muted">transcript turns</span>
            </div>
            <div>
              <strong>{formatDuration(sessionDuration)}</strong>
              <span className="muted">duration</span>
            </div>
          </div>
          <Link
            className="btn btn-primary"
            href={links.analysis}
            style={{ marginTop: 18 }}
          >
            Analyze interview
          </Link>
          <Link
            className="btn btn-secondary"
            href={links.workspace}
            style={{ marginTop: 10 }}
          >
            {links.workspaceLabel}
          </Link>
        </section>
      )}

      {state === "error" && (
        <section className="card live-error-card">
          <div className="live-error-icon" aria-hidden="true">⚠</div>
          <h2 style={{ fontSize: 28, margin: "10px 0 8px" }}>
            Something went wrong
          </h2>
          <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
            {error || "Odesseus Live encountered an error. Please try again."}
          </p>
          <div className="live-error-actions">
            <button className="btn btn-primary" type="button" onClick={retryLive}>
              Try again
            </button>
            <Link className="btn btn-secondary" href={links.workspace}>
              {links.workspaceLabel}
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
