const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  net,
  session,
  desktopCapturer,
  shell,
} = require("electron");
const path = require("node:path");

const PROTOCOL = "odesseus";
const WEB_ORIGIN = process.env.ODESSEUS_WEB_ORIGIN || "https://odesseus.ai";
const ALLOWED_API_PATHS = new Set([
  "/api/live/desktop/exchange",
  "/api/live/desktop/prepare",
  "/api/live/desktop/webrtc",
  "/api/live/desktop/activate",
  "/api/live/desktop/transcript",
  "/api/live/desktop/end",
]);

let overlayWindow = null;
let tray = null;
let pendingLaunchTicket = null;
let desktopAccessToken = null;
let desktopSession = null;
let clickThrough = false;

function extractLaunchTicket(raw) {
  if (!raw || typeof raw !== "string" || !raw.startsWith(`${PROTOCOL}://`)) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.hostname !== "live") return null;
    const ticket = parsed.searchParams.get("ticket");
    return ticket && ticket.length >= 16 ? ticket : null;
  } catch {
    return null;
  }
}

function findProtocolUrl(argv) {
  return argv.find((entry) => typeof entry === "string" && entry.startsWith(`${PROTOCOL}://`)) || null;
}

function registerProtocolClient() {
  if (process.defaultApp && process.argv.length >= 2) {
    return app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
  return app.setAsDefaultProtocolClient(PROTOCOL);
}

function trayIcon() {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" rx="9" fill="#111111"/>' +
    '<circle cx="16" cy="16" r="9" fill="none" stroke="#ffffff" stroke-width="3"/>' +
    '<circle cx="16" cy="16" r="3" fill="#ffffff"/>' +
    "</svg>";
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

function sendState() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.webContents.send("odesseus:state", {
    hasLaunchTicket: Boolean(pendingLaunchTicket),
    connected: Boolean(desktopAccessToken),
    session: desktopSession,
    clickThrough,
    webOrigin: WEB_ORIGIN,
  });
}

function setClickThrough(enabled) {
  clickThrough = Boolean(enabled);
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(clickThrough, { forward: true });
  }
  sendState();
}

function setOverlayVisible(visible) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (visible) {
    overlayWindow.showInactive();
    overlayWindow.setAlwaysOnTop(true, "screen-saver");
  } else {
    overlayWindow.hide();
  }
}

function toggleOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  setOverlayVisible(!overlayWindow.isVisible());
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 430,
    height: 560,
    minWidth: 330,
    minHeight: 220,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    resizable: true,
    movable: true,
    show: false,
    skipTaskbar: false,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  overlayWindow.setContentProtection(true);
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  overlayWindow.once("ready-to-show", () => {
    setOverlayVisible(Boolean(pendingLaunchTicket));
    sendState();
  });

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}

async function apiFetch(apiPath, { method = "POST", body } = {}) {
  if (!ALLOWED_API_PATHS.has(apiPath)) throw new Error("That desktop API path is not allowed.");

  const headers = { "Content-Type": "application/json" };
  if (desktopAccessToken && apiPath !== "/api/live/desktop/exchange") {
    headers.Authorization = `Bearer ${desktopAccessToken}`;
  }

  const response = await net.fetch(`${WEB_ORIGIN}${apiPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : `Odesseus Live request failed (${response.status}).`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function exchangeTicket(ticket) {
  const payload = await apiFetch("/api/live/desktop/exchange", { body: { ticket } });
  if (typeof payload?.accessToken !== "string" || !payload.accessToken) {
    throw new Error("Odesseus did not return a desktop session token.");
  }

  desktopAccessToken = payload.accessToken;
  desktopSession = {
    interviewId: payload.interviewId || null,
    liveSessionId: payload.liveSessionId || null,
    status: payload.status || null,
    expiresAt: payload.expiresAt || null,
    context: payload.context || null,
  };
  pendingLaunchTicket = null;
  sendState();
  return desktopSession;
}

function handleDeepLink(raw) {
  const ticket = extractLaunchTicket(raw);
  if (!ticket) return false;

  pendingLaunchTicket = ticket;
  desktopAccessToken = null;
  desktopSession = null;

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow();
  } else {
    setClickThrough(false);
    setOverlayVisible(true);
    overlayWindow.focus();
    sendState();
  }
  return true;
}

function setupDisplayMediaCapture() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const trusted = webContents === overlayWindow?.webContents;
    if (!trusted) return callback(false);
    if (permission === "media") return callback(true);
    callback(false);
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const trusted = request.frame && request.frame === overlayWindow?.webContents.mainFrame;
    if (!trusted || !request.audioRequested) {
      callback(null);
      return;
    }

    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1, height: 1 },
      });
      const primary = sources[0];
      if (!primary) return callback(null);
      callback({ video: primary, audio: "loopback" });
    } catch {
      callback(null);
    }
  });
}

function setupTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip("Odesseus Live");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Odesseus Live", click: () => setOverlayVisible(true) },
      { label: "Hide overlay", click: () => setOverlayVisible(false) },
      { label: "Toggle click-through", click: () => setClickThrough(!clickThrough) },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ])
  );
  tray.on("double-click", () => toggleOverlay());
}

function setupShortcuts() {
  globalShortcut.register("CommandOrControl+Shift+O", () => toggleOverlay());
  globalShortcut.register("CommandOrControl+Shift+I", () => setClickThrough(!clickThrough));
  globalShortcut.register("CommandOrControl+Shift+G", () => {
    overlayWindow?.webContents.send("odesseus:shortcut", "generate");
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    const url = findProtocolUrl(commandLine);
    if (url) handleDeepLink(url);
    if (overlayWindow) {
      setOverlayVisible(true);
      overlayWindow.focus();
    }
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  registerProtocolClient();

  app.whenReady().then(() => {
    const initialUrl = findProtocolUrl(process.argv);
    if (initialUrl) pendingLaunchTicket = extractLaunchTicket(initialUrl);

    createOverlayWindow();
    setupDisplayMediaCapture();
    setupTray();
    setupShortcuts();

    app.on("activate", () => {
      if (!overlayWindow) createOverlayWindow();
      setOverlayVisible(true);
    });
  });
}

app.on("window-all-closed", (event) => event.preventDefault());
app.on("will-quit", () => globalShortcut.unregisterAll());

ipcMain.handle("odesseus:get-state", async () => ({
  hasLaunchTicket: Boolean(pendingLaunchTicket),
  connected: Boolean(desktopAccessToken),
  session: desktopSession,
  clickThrough,
  webOrigin: WEB_ORIGIN,
  version: app.getVersion(),
}));

ipcMain.handle("odesseus:exchange-ticket", async () => {
  if (!pendingLaunchTicket) throw new Error("No Odesseus launch ticket is waiting.");
  return exchangeTicket(pendingLaunchTicket);
});

ipcMain.handle("odesseus:api", async (_event, apiPath, options) => apiFetch(apiPath, options || {}));
ipcMain.handle("odesseus:set-opacity", async (_event, value) => {
  const opacity = Math.max(0.35, Math.min(1, Number(value) || 1));
  overlayWindow?.setOpacity(opacity);
  return opacity;
});
ipcMain.handle("odesseus:set-click-through", async (_event, value) => {
  setClickThrough(Boolean(value));
  return clickThrough;
});
ipcMain.handle("odesseus:open-web-path", async (_event, webPath) => {
  if (typeof webPath !== "string" || !webPath.startsWith("/interviews/")) {
    throw new Error("That Odesseus web path is not allowed.");
  }
  const url = new URL(webPath, WEB_ORIGIN);
  if (url.origin !== WEB_ORIGIN) {
    throw new Error("That Odesseus web path is not allowed.");
  }
  await shell.openExternal(url.toString());
  return true;
});
ipcMain.handle("odesseus:hide", async () => setOverlayVisible(false));
ipcMain.handle("odesseus:quit", async () => app.quit());
