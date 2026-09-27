// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { ApiEvents, Unsubscribe } from "../client";
import type { ServerEvent } from "../events";

type ConnState = "connecting" | "online" | "offline";

/** Close codes from docs/api/ws-events.md */
export const WS_CLOSE = {
  unauthorized: 4401,
  authTimeout: 4408,
} as const;

/**
 * Live WebSocket client — docs/api/ws-events.md:
 * connect → first frame is `auth` (never a URL token) → server replies
 * `auth.ok`/`auth.fail`. Reconnects pass `?last_seq=N` for replay.
 * `seq`/`ts` exist on server→client frames only.
 */
export class WsClient implements ApiEvents {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<(ev: ServerEvent) => void>>();
  private stateCbs = new Set<(s: ConnState) => void>();
  private lastSeq = 0;

  constructor(private readonly wsUrl: string) {}

  connect(accessToken: string, lastSeq?: number): Promise<void> {
    this.disconnect();
    this.setState("connecting");

    const url = new URL(
      this.wsUrl,
      typeof location === "undefined" ? "http://localhost" : location.origin,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const seq = lastSeq ?? this.lastSeq;
    if (seq > 0) url.searchParams.set("last_seq", String(seq));

    const ws = new WebSocket(url);
    this.ws = ws;

    return new Promise((resolve, reject) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "auth", data: { accessToken } }));
      };
      ws.onmessage = (e) => {
        const frame = JSON.parse(String(e.data)) as ServerEvent;
        if (frame.type === "auth.ok") {
          this.setState("online");
          resolve();
          return;
        }
        if (frame.type === "auth.fail") {
          reject(new Error("ws auth failed"));
          return;
        }
        if ("seq" in frame && typeof frame.seq === "number") {
          this.lastSeq = Math.max(this.lastSeq, frame.seq);
        }
        this.dispatch(frame);
      };
      ws.onclose = () => {
        this.setState("offline");
        reject(new Error("ws closed before auth"));
      };
      ws.onerror = () => {
        this.setState("offline");
      };
    });
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.setState("offline");
  }

  onStateChange(cb: (s: ConnState) => void): Unsubscribe {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }

  on<T extends ServerEvent["type"]>(
    type: T,
    cb: (ev: Extract<ServerEvent, { type: T }>) => void,
  ): Unsubscribe {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const fn = cb as (ev: ServerEvent) => void;
    set.add(fn);
    return () => set.delete(fn);
  }

  typingStart(chatId: string): void {
    this.send({ type: "typing.start", data: { chatId } });
  }

  typingStop(chatId: string): void {
    this.send({ type: "typing.stop", data: { chatId } });
  }

  receiptRead(chatId: string, upToSeq: number): void {
    this.send({ type: "receipt.read", data: { chatId, upToSeq } });
  }

  ping(): void {
    this.send({ type: "ping", data: {} });
  }

  private send(frame: { type: string; data: unknown }): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  private dispatch(ev: ServerEvent): void {
    for (const cb of this.listeners.get(ev.type) ?? []) cb(ev);
  }

  private setState(s: ConnState): void {
    for (const cb of this.stateCbs) cb(s);
  }
}
