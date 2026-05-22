export {};

declare global {
  interface Window {
    // Exposed by the Electron preload (electron/preload.ts). Absent when the
    // app runs in a plain browser (dev).
    mailbun?: {
      isElectron: boolean;
      platform: string;
      setZoom: (factor: number) => void;
      getZoom: () => number;
    };
  }
}
