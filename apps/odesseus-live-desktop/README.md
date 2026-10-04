# Odesseus Live Desktop

Windows-first Electron companion for private interview guidance.

## Implemented in this slice

- `odesseus://` deep-link protocol registration.
- Single-instance tray application.
- Transparent, borderless, draggable, resizable, always-on-top overlay.
- Click-through and opacity controls.
- Electron content protection for the overlay.
- Windows system-audio loopback capture.
- Short-lived launch-ticket handoff contract.
- Narrow preload bridge with Node integration disabled.

## Local run

```powershell
Set-Location apps\odesseus-live-desktop
npm install
npm start
```

For local web development:

```powershell
$env:ODESSEUS_WEB_ORIGIN="http://localhost:3000"
npm start
```

## Build installer

```powershell
npm run dist:win
```

Installer output: `OdesseusLiveSetup-<version>.exe`.

## Deep-link contract

```text
odesseus://live?ticket=<short-lived-one-time-ticket>
```

The raw launch ticket stays in the Electron main process and is exchanged for a short-lived desktop access token. Website credentials are never embedded in the URL.
