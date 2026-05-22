import type { ServerEvent } from "@mailclient/shared";

type Handler = (ev: ServerEvent) => void;

class SocketBridge {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private reconnectTimer: number | null = null;

  start() {
    if (this.ws) return;
    this.connect();
  }

  private connect() {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/ws`;
    try {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.addEventListener("message", (m) => {
        try {
          const ev = JSON.parse(m.data) as ServerEvent;
          for (const h of this.handlers) h(ev);
        } catch {
          /* ignore malformed messages */
        }
      });
      ws.addEventListener("close", () => {
        this.ws = null;
        this.scheduleReconnect();
      });
      ws.addEventListener("error", () => {
        try { ws.close(); } catch { /* ignore */ }
      });
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  on(h: Handler) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }
}

export const socket = new SocketBridge();
