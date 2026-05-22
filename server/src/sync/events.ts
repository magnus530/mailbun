import { EventEmitter } from "node:events";
import type { ServerEvent } from "@mailclient/shared";

export const events = new EventEmitter();

export function emit(ev: ServerEvent) {
  events.emit("event", ev);
}
