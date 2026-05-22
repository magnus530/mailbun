import { contextBridge, webFrame } from "electron";

// Intentionally tiny surface. The renderer talks to the local server over
// HTTP/WS, so nothing privileged needs to cross the context bridge yet.
contextBridge.exposeInMainWorld("mailbun", {
  isElectron: true,
  platform: process.platform,
  // Native Chromium page zoom — the exact mechanism Ctrl +/- uses. Reflows
  // layout cleanly and, unlike CSS zoom, can't fight Electron's own zoom.
  setZoom: (factor: number) => webFrame.setZoomFactor(factor),
  getZoom: () => webFrame.getZoomFactor(),
});
