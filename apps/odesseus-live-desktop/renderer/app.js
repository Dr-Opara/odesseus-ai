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

let live = false;
let sessionStartedAt = null;
let timerId = null;

function showError(message) {
  errorBox.textContent = String(message || "Something went wrong.");
  errorBox.classList.remove("hidden");
}
function clearError() {
  errorBox.textContent = "";
  errorBox.classList.add("hidden");
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
  timerId = setInterval(() => { timer.textContent = formatElapsed(); }, 1000);
}
function stopTimer() {
  clearInterval(timerId);
  timerId = null;
}
function applyState(state) {
  clickThrough.checked = Boolean(state?.clickThrough);
  if (state?.connected) {
    launchPanel.classList.add("hidden");
    livePanel.classList.remove("hidden");
    statusDot.textContent = live ? "Live" : "Connected";
    const context = state?.session?.context;
    const role = context?.application?.roleTitle || "Interview";
    const company = context?.application?.companyName;
    sessionTitle.textContent = company ? `${role} · ${company}` : role;
    return;
  }

  launchPanel.classList.remove("hidden");
  livePanel.classList.add("hidden");
  if (state?.hasLaunchTicket) {
    statusDot.textContent = "Ticket received";
    connectButton.disabled = false;
    connectButton.textContent = "Open interview session";
  } else {
    statusDot.textContent = "Waiting";
    connectButton.disabled = true;
    connectButton.textContent = "Waiting for Odesseus…";
  }
}
async function refreshState() {
  try { applyState(await bridge.getState()); } catch (error) { showError(error.message); }
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
  const display = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
  const audio = display.getAudioTracks()[0];
  display.getVideoTracks().forEach((track) => track.stop());
  if (!audio) {
    display.getTracks().forEach((track) => track.stop());
    throw new Error("Windows system audio could not be captured.");
  }
  return new MediaStream([audio]);
}
async function startSession() {
  clearError();
  startButton.disabled = true;
  startButton.textContent = "Starting…";
  try {
    const systemAudio = await getSystemAudio();
    window.__odesseusSystemAudio = systemAudio;
    live = true;
    statusDot.textContent = "Audio ready";
    answer.textContent = "System audio is connected. Realtime transcription transport is the next wiring step.";
    startTimer();
    endButton.disabled = false;
    startButton.textContent = "Audio connected";
  } catch (error) {
    startButton.disabled = false;
    startButton.textContent = "Start session";
    showError(error.message);
  }
}
async function endSession() {
  window.__odesseusSystemAudio?.getTracks().forEach((track) => track.stop());
  window.__odesseusSystemAudio = null;
  live = false;
  stopTimer();
  statusDot.textContent = "Connected";
  endButton.disabled = true;
  startButton.disabled = false;
  startButton.textContent = "Start session";
  question.textContent = "Listening for the interviewer…";
  answer.textContent = "Odesseus will surface a concise answer when it confidently detects a question.";
}

connectButton.addEventListener("click", exchangeTicket);
startButton.addEventListener("click", startSession);
endButton.addEventListener("click", endSession);
$("hideButton").addEventListener("click", () => bridge.hide());
$("quitButton").addEventListener("click", () => bridge.quit());
opacity.addEventListener("input", () => bridge.setOpacity(Number(opacity.value) / 100));
clickThrough.addEventListener("change", () => bridge.setClickThrough(clickThrough.checked));
document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => { question.textContent = `${button.textContent} guidance requested`; });
});
generateButton.addEventListener("click", () => { question.textContent = "Manual guidance requested"; });
bridge.onState((state) => applyState(state));
bridge.onShortcut((action) => { if (action === "generate") generateButton.click(); });
refreshState();
