"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { canStartLive, createTurnSequencer } from "@/lib/live/session-state";
import { waitForIceGatheringComplete, waitForPeerConnected } from "@/lib/live/webrtc-timing";

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

export default function OdysseusLiveClient({
  interviewId,
  interviewPasses,
}: {
  interviewId: string;
  interviewPasses: number;
}) {
  const router = useRouter();
  const [captureMode, setCaptureMode] = useState<CaptureMode>("shared_audio");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<
    "idle" | "connecting" | "live" | "ending" | "ended" | "error"
  >("idle");
  const [statusText, setStatusText] = useState("Ready when the interview starts.");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [lastQuestion, setLastQuestion] = useState("");
  const [busyMode, setBusyMode] = useState<GuidanceMode | null>(null);
  const [error, setError] = useState("");

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const partialRef = useRef<Record<string, string>>({});
  const manualRequestIdRef = useRef(0);
  const turnSequencerRef = useRef(createTurnSequencer());

  const canStart = canStartLive(state, consent, interviewPasses);

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

  const saveTranscriptAndGuide = useCallback(
    async (
      sid: string,
      itemId: string,
      transcript: string,
      mode: GuidanceMode = "default",
      forceGuidance = false
    ) => {
      const turnIndex = turnIndexFor(itemId);

      const response = await fetch(
        `/api/interviews/${interviewId}/live/transcript`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sid,
            itemId,
            transcript,
            mode,
            forceGuidance,
            turnIndex,
          }),
        }
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Odysseus could not process the transcript.");
      }

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
      }

      return data;
    },
    [interviewId, turnIndexFor]
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
              : "Odysseus could not process a transcript segment."
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
      const prepareResponse = await fetch(
        `/api/interviews/${interviewId}/live/prepare`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ captureMode, consent: true }),
        }
      );

      const prepareData = await prepareResponse.json();
      if (!prepareResponse.ok) {
        throw new Error(
          prepareData.error || "Odysseus could not prepare the Live session."
        );
      }

      const preparedSessionId = prepareData.sessionId as string;
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

      setStatusText("Connecting secure transcription…");

      const webrtcResponse = await fetch(
        `/api/interviews/${interviewId}/live/webrtc`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: preparedSessionId,
            sdp: finalSdp,
          }),
        }
      );

      const realtimePayload = await webrtcResponse.json().catch(() => null);

      if (!webrtcResponse.ok || !realtimePayload?.sdp) {
        throw new Error(
          realtimePayload?.error?.message ||
            realtimePayload?.error ||
            "OpenAI Realtime could not connect."
        );
      }

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
          "Odysseus could not establish a stable realtime connection. Please try again."
        );
      }

      const activateResponse = await fetch(
        `/api/interviews/${interviewId}/live/activate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: preparedSessionId,
            openaiSessionId: extractSessionId(realtimePayload),
          }),
        }
      );

      const activateData = await activateResponse.json();
      if (!activateResponse.ok) {
        throw new Error(
          activateData.error || "Odysseus could not activate the Live session."
        );
      }

      setState("live");
      setStatusText("Odysseus Live is listening for interview questions.");
      router.refresh();
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
        err instanceof Error ? err.message : "Odysseus Live could not start."
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
        err instanceof Error ? err.message : "Odysseus could not refresh guidance."
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
      const response = await fetch(
        `/api/interviews/${interviewId}/live/end`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        }
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Odysseus could not end Live cleanly.");
      }

      setState("ended");
      setStatusText("Interview ended. Transcript context is ready for analysis.");
      router.refresh();
    } catch (err) {
      setState("error");
      setError(
        err instanceof Error ? err.message : "Odysseus could not close the session."
      );
    }
  }

  return (
    <div className="live-client-grid">
      <section className="card live-control-card">
        <div>
          <div className="muted" style={{ fontSize: 13 }}>
            Audio source
          </div>
          <h2 style={{ fontSize: 24, margin: "7px 0 6px" }}>
            What should Odysseus listen to?
          </h2>
          <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
            {modeCopy}
          </p>
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
          <strong>
            {interviewPasses} interview pass{interviewPasses === 1 ? "" : "es"} available
          </strong>
          <span className="muted">
            No pass is used until the realtime connection successfully activates.
          </span>
        </div>

        {error ? <div className="apply-error">{error}</div> : null}

        <div className="live-controls">
          {state === "idle" || state === "error" ? (
            <button
              className="btn btn-primary"
              type="button"
              onClick={startLive}
              disabled={!consent || interviewPasses < 1}
            >
              {state === "error" ? "Try again" : "Start Odysseus Live"}
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

            {guidance.caution ? (
              <div className="review-note">{guidance.caution}</div>
            ) : null}

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
          </>
        ) : (
          <div className="live-waiting">
            <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
              Odysseus only surfaces guidance when it identifies a question or clear request for you to respond.
            </p>
          </div>
        )}
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
    </div>
  );
}
