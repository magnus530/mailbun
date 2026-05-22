import type { OAuthProvider } from "@mailclient/shared";

// In-memory store of pending OAuth flows. Each /authorize call creates an
// entry keyed by state; /callback consumes it. Entries auto-expire after 10
// minutes to avoid leaks if the user abandons the flow.

interface PendingFlow {
  provider: OAuthProvider;
  verifier: string;
  createdAt: number;
  // Origin of the SPA that started the flow (e.g. http://127.0.0.1:5173 in
  // dev). Used to send the user back to the right place after the callback.
  // Same-origin in prod, cross-origin in dev where Vite proxies to us.
  spaOrigin: string;
}

const store = new Map<string, PendingFlow>();
const TTL_MS = 10 * 60_000;

export const stateStore = {
  put(state: string, flow: PendingFlow) {
    store.set(state, flow);
  },
  take(state: string): PendingFlow | null {
    const v = store.get(state);
    if (!v) return null;
    store.delete(state);
    if (Date.now() - v.createdAt > TTL_MS) return null;
    return v;
  },
  sweep() {
    const now = Date.now();
    for (const [k, v] of store) {
      if (now - v.createdAt > TTL_MS) store.delete(k);
    }
  },
};

setInterval(() => stateStore.sweep(), 60_000).unref();
