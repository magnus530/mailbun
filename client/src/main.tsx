import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import "./index.css";

// Apply persisted theme before the first paint so we don't flash from dark
// → light during boot. Key is shared with useAppStore.setTheme.
if (localStorage.getItem("mailclient.theme") === "light") {
  document.documentElement.classList.add("theme-light");
}

// Likewise apply persisted zoom before render so the layout doesn't jump.
// Electron: native page zoom (resets to 1.0 on a fresh window, so it must
// be re-applied every launch). Browser: the --zoom CSS variable.
const savedZoom = Number(localStorage.getItem("mailbun.zoom"));
if (savedZoom >= 0.5 && savedZoom <= 3.0) {
  if (window.mailbun?.isElectron) {
    window.mailbun.setZoom(savedZoom);
  } else {
    document.documentElement.style.setProperty("--zoom", String(savedZoom));
  }
}

const qc = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

// Register PWA service worker. The dev server doesn't proxy /sw.js to the
// backend, and we never want it active while developing because Vite handles
// HMR — so only register in production builds. We also skip it inside the
// Electron desktop shell: the SW's offline cache serves no purpose there and
// can pin stale assets across app updates.
const isElectron = navigator.userAgent.toLowerCase().includes("electron");
if ("serviceWorker" in navigator && import.meta.env.PROD && !isElectron) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("sw registration failed", err);
    });
  });
}
