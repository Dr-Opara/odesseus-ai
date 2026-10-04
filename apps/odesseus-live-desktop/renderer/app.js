const bridge = window.odesseusDesktop;
const $ = (id) => document.getElementById(id);

const launchPanel = $("launchPanel");
const livePanel = $("livePanel");
const connectButton = $("connectButton");
const startButton = $("startButton");
const endButton = $("endButton");
const generateButton = $("generateButton");
const opacity = $("opacity");
const clickThrough = $("clickThrough");
const statusDot = $("statusDot");
const sessionTitle = $("sessionTitle");
const question = $("question");
const answer = $("answer");
const errorBox = $("errorBox");
const timer = $("timer");

const END_DRAIN_MS = 1200;

let live = false;
let sessionStartedAt = null;
let timerId = null;
let peer = null;
let dataChannel = null;
let captureStream = null;
let desktopState = null;
let lastQuestion = "";
let requestCounter = 0;
let turnCounter = 0;
const turnIndexes = new Map();
const partials = new Map();
const completedItems = new Set();

function showError(message) {
  errorBox.textContent = String(message || "Something went wrong.");
  errorBox.classList.remove("hidden");
}

function clearError() {
  errorBox.textContent = "";
  errorBox.classList.add("hidden");
}

function setStatus(text) {
  statusDot.textContent = text;
}

function formatElapsed() {
  if (!sessionStartedAt) return "00:00";
  const seconds = Math.max(0, Math.floor((Date.now() - sessionStartedAt) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function startTimer() {
  sessionStartedAt = Date.now();
  timer.textContent = "00:00";
  clearInterval(timerId);
  timerId = setInterval(() => {
    timer.textContent = formatElapsed();
  }, 1000);
}

function stopTimer() {
  clearInterval(timerId);
  timerId = null;
}

function getTurnIndex(itemId) {
  if (!turnIndexes.has(itemId)) {
    turnIndexes.set(itemId, turnCounter++);
  }
  return turnIndexes.get(itemId);
}

function applyState(state) {
  desktopState = state;
  clickThrough.checked = Boolean(state?.clickThrough);

  if (state?.connected) {
    launchPanel.classList.add("hidden");
    livePanel.classList.remove("hidden");
    setStatus(live ? "Live" : "Connected");

    const context = state?.session?.context;
    const role = context?.application?.roleTitle || "Interview";
    const company = context?.application?.companyName;
    sessionTitle.textContent = company ? `${role} · ${company}` : role;
    return;
  }

  launchPanel.classList.remove("hidden");
  livePanel.classList.add("hidden");

  if (state?.hasLaunchTicket) {
    setStatus("Ticket received");
    connectButton.disabled = false;
    connectButton.textContent = "Open interview session";
  } else {
    setStatus("Waiting");
    connectButton.disabled = true;
    connectButton.textContent = "Waiting for Odesseus…";
  }
}

async function refreshState() {
  try {
    applyState(await bridge.getState());
  } catch (error) {
    showError(error.message);
  }
}

async function exchangeTicket() {
  clearError();
  connectButton.disabled = true;
  connectButton.textContent = "Connecting…";

  try {
    await bridge.exchangeTicket();
    await refreshState();
  } catch (error) {
    connectButton.disabled = false;
    connectButton.textContent = "Try again";
    showError(error.message);
  }
}

async function getSystemAudio() {
  const display = await navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: true,
  });

  const audioTrack = display.getAudioTracks()[0];
  display.getVideoTracks().forEach((track) => track.stop());

  if (!audioTrack) {
    display.getTracks().forEach((track) => track.stop());
    throw new Error("Windows system audio could not be captured.");
  }

  return new MediaStream([audioTrack]);
}

function waitForIceGatheringComplete(connection, timeoutMs = 8000) {
  if (connection.iceGatheringState === "complete") return Promise.resolve();

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      connection.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (connection.iceGatheringState === "complete") finish();
    };
    const timeout = setTimeout(finish, timeoutMs);
    connection.addEventListener("icegatheringstatechange", onChange);
  });
}

function waitForPeerConnected(connection, timeoutMs = 12000) {
  if (connection.connectionState === "connected") return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      connection.removeEventListener("connectionstatechange", onChange);
      resolve(value);
    };
    const onChange = () => {
      if (connection.connectionState === "connected") finish(true);
      if (["failed", "closed"].includes(connection.connectionState)) finish(false);
    };
    const timeout = setTimeout(() => finish(false), timeoutMs);
    connection.addEventListener("connectionstatechange", onChange);
  });
}

function extractOpenAiSessionId(payload) {
  return payload?.id || payload?.session?.id || "realtime";
}

function renderGuidance(payload, fallbackQuestion) {
  if (payload?.guidance) {
    const guidance = payload.guidance;
    lastQuestion = payload.questionText || guidance.question_text || fallbackQuestion || lastQuestion;
    question.textContent = lastQuestion;

    const parts = [];
    if (guidance.response_text) parts.push(guidance.response_text);
    if (guidance.structure) parts.push(`\n${guidance.structure}`);
    if (Array.isArray(guidance.verified_evidence) && guidance.verified_evidence.length) {
      parts.push(`\nEvidence: ${guidance.verified_evidence.join(" · ")}`);
    }
    if (guidance.caution) parts.push(`\nNote: ${guidance.caution}`);

    answer.textContent = parts.filter(Boolean).join("").trim() || "Guidance is ready.";
    return;
  }

  if (payload?.guidanceUnavailable) {
    question.textContent = fallbackQuestion || lastQuestion || "Question detected";
    answer.textContent = "The question was captured, but guidance could not be generated. You can press Generate to retry.";
  }
}

async function submitTranscript({
  itemId,
  transcript,
  mode = "default",
  forceGuidance = false,
  turnIndex,
}) {
  const payload = await bridge.api("/api/live/desktop/transcript", {
    body: {
      itemId,
      transcript,
      mode,
      forceGuidance,
      turnIndex,
    },
  });

  if (payload?.isQuestion || payload?.guidanceUnavailable) {
    renderGuidance(payload, transcript);
  }
  return payload;
}

async function handleRealtimeEvent(event) {
  const type = String(event?.type || "");
  const itemId = String(
    event?.item_id ||
      event?.item?.id ||
      event?.id ||
      `segment-${++requestCounter}`
  );

  const turnIndex = getTurnIndex(itemId);

  if (
    type === "conversation.item.input_audio_transcription.delta" ||
    type === "input_audio_transcription.delta"
  ) {
    partials.set(itemId, (partials.get(itemId) || "") + String(event?.delta || ""));
    return;
  }

  if (
    type === "conversation.item.input_audio_transcription.completed" ||
    type === "input_audio_transcription.completed"
  ) {
    if (completedItems.has(itemId)) return;

    const transcript = String(
      event?.transcript ||
        event?.item?.content?.[0]?.transcript ||
        partials.get(itemId) ||
        ""
    ).trim();

    partials.delete(itemId);
    if (!transcript) return;

    completedItems.add(itemId);

    try {
      await submitTranscript({
        itemId,
        transcript,
        turnIndex,
      });
    } catch (error) {
      completedItems.delete(itemId);
      showError(error.message);
    }
    return;
  }

  if (type === "error") {
    showError(event?.error?.message || "Realtime transcription reported an error.");
  }
}

function cleanupConnection() {
  captureStream?.getTracks().forEach((track) => track.stop());
  dataChannel?.close();
  peer?.close();
  captureStream = null;
  dataChannel = null;
  peer = null;
}

async function startSession() {
  clearError();
  startButton.disabled = true;
  startButton.textContent = "Starting…";
  setStatus("Connecting");

  try {
    captureStream = await getSystemAudio();

    peer = new RTCPeerConnection();
    for (const track of captureStream.getAudioTracks()) {
      peer.addTrack(track, captureStream);
    }

    dataChannel = peer.createDataChannel("oai-events");

    dataChannel.addEventListener("message", (message) => {
      try {
        void handleRealtimeEvent(JSON.parse(message.data));
      } catch {
        // Ignore non-JSON provider events.
      }
    });

    dataChannel.addEventListener("open", () => setStatus("Transcription connected"));

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    setStatus("Securing audio");
    await waitForIceGatheringComplete(peer);

    const finalSdp = peer.localDescription?.sdp || offer.sdp;
    if (!finalSdp) {
      throw new Error("Odesseus could not read the realtime audio offer.");
    }

    const realtime = await bridge.api("/api/live/desktop/webrtc", {
      body: { sdp: finalSdp },
    });

    await peer.setRemoteDescription({
      type: "answer",
      sdp: realtime.sdp,
    });

    setStatus("Establishing connection");
    const connected = await waitForPeerConnected(peer);
    if (!connected) {
      throw new Error("Odesseus could not establish a stable realtime connection.");
    }

    // Pass/subscription consumption happens here and only here: after the
    // realtime peer is actually connected.
    await bridge.api("/api/live/desktop/activate", {
      body: { openaiSessionId: extractOpenAiSessionId(realtime) },
    });

    live = true;
    startTimer();
    setStatus("Live");
    startButton.textContent = "Live";
    endButton.disabled = false;
    question.textContent = "Listening for the interviewer…";
    answer.textContent = "Odesseus is listening. Guidance will appear automatically when a question is detected.";
  } catch (error) {
    cleanupConnection();
    live = false;
    setStatus("Could not start");
    startButton.disabled = false;
    startButton.textContent = "Start session";
    showError(error.message);
  }
}

async function requestGuidance(mode) {
  if (!live || !lastQuestion) {
    showError("Wait for a detected question before requesting a rewrite.");
    return;
  }

  clearError();
  requestCounter += 1;
  const buttonId = `manual-${mode}-${requestCounter}`;

  try {
    const payload = await submitTranscript({
      itemId: buttonId,
      transcript: lastQuestion,
      mode,
      forceGuidance: true,
      turnIndex: turnCounter++,
    });
    renderGuidance(payload, lastQuestion);
  } catch (error) {
    showError(error.message);
  }
}

async function endSession() {
  if (!live) return;

  endButton.disabled = true;
  setStatus("Ending");

  // Stop sending new audio immediately, but leave the data channel open long
  // enough for the provider to deliver a final completed transcription event.
  captureStream?.getTracks().forEach((track) => track.stop());
  await new Promise((resolve) => setTimeout(resolve, END_DRAIN_MS));

  try {
    const ended = await bridge.api("/api/live/desktop/end", { body: {} });
    live = false;
    stopTimer();
    cleanupConnection();
    setStatus("Ended");
    startButton.disabled = true;
    startButton.textContent = "Session ended";
    question.textContent = "Interview captured";
    answer.textContent = "Your transcript is saved to Odesseus. Opening post-interview analysis in your browser…";
    if (ended?.analysisUrl) {
      window.setTimeout(() => {
        void bridge.openWebPath(ended.analysisUrl).catch((error) => showError(error.message));
      }, 500);
    }
  } catch (error) {
    endButton.disabled = false;
    setStatus("Live");
    showError(error.message);
  }
}

connectButton.addEventListener("click", exchangeTicket);
startButton.addEventListener("click", startSession);
endButton.addEventListener("click", endSession);
$("hideButton").addEventListener("click", () => bridge.hide());
$("quitButton").addEventListener("click", () => bridge.quit());

opacity.addEventListener("input", () => {
  bridge.setOpacity(Number(opacity.value) / 100);
});

clickThrough.addEventListener("change", () => {
  bridge.setClickThrough(clickThrough.checked);
});

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => requestGuidance(button.dataset.mode));
});

generateButton.addEventListener("click", () => requestGuidance("manual"));

bridge.onState((state) => applyState(state));
bridge.onShortcut((action) => {
  if (action === "generate") requestGuidance("manual");
});

window.addEventListener("beforeunload", () => {
  cleanupConnection();
  stopTimer();
});

refreshState();
