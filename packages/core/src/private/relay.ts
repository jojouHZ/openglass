// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Relay WS client — docs/api/relay-events.md.
 * Separate socket from the public /ws: auth-first-frame, opaque envelopes,
 * private-session lifecycle events. Carries no plaintext — blobs only.
 */

export interface PeerUser {
  id: string;
  displayName?: string | null;
  tag?: string | null;
  avatarUrl?: string | null;
}

export type RelayEvent =
  | { type: "auth.ok"; data: Record<string, never> }
  | { type: "auth.fail"; data: { code: string } }
  | {
      type: "relay.invite";
      data: {
        sessionId: string;
        from: PeerUser;
        ttlSeconds: number;
        burnOnRead: boolean;
        strict: boolean;
      };
    }
  | {
      type: "relay.invited";
      data: {
        sessionId: string;
        to: PeerUser;
        ttlSeconds: number;
        burnOnRead: boolean;
        strict: boolean;
      };
    }
  | {
      type: "relay.established";
      data: { sessionId: string; peer: PeerUser; resumeToken: string; ttlEndsAt: string };
    }
  | { type: "relay.declined"; data: { sessionId: string } }
  | { type: "relay.msg"; data: { sessionId: string; msgSeq: number; blob: string } }
  | { type: "relay.peer-offline"; data: { sessionId: string; graceEndsAt: string } }
  | { type: "relay.peer-online"; data: { sessionId: string } }
  | {
      type: "relay.closed";
      data: { sessionId: string; reason: "timer" | "burned" | "expired" | "peer-gone" | "revoked" };
    }
  | { type: "relay.error"; data: { code: string } }
  | { type: "pong"; data: Record<string, never> };

export type ConnState = "connecting" | "online" | "offline";

export const RELAY_CLOSE = {
  unauthorized: 4401,
  authTimeout: 4408,
} as const;

export class RelayClient {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<(ev: RelayEvent) => void>>();
  private stateCbs = new Set<(s: ConnState) => void>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly wsUrl: string) {}

  connect(accessToken: string): Promise<void> {
    const old = this.ws;
    this.ws = null;
    if (old) {
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      old.close();
    }
    this.setState("connecting");

    const url = new URL(
      this.wsUrl,
      typeof location === "undefined" ? "http://localhost" : location.origin,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

    const ws = new WebSocket(url);
    this.ws = ws;

    return new Promise((resolve, reject) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "auth", data: { accessToken } }));
      };
      ws.onmessage = (e) => {
        const frame = JSON.parse(String(e.data)) as RelayEvent;
        if (frame.type === "auth.ok") {
          this.setState("online");
          this.heartbeat ??= setInterval(() => this.ping(), 30_000);
          resolve();
          return;
        }
        if (frame.type === "auth.fail") {
          reject(new Error("relay auth failed"));
          return;
        }
        this.dispatch(frame);
      };
      ws.onclose = () => {
        this.stopHeartbeat();
        this.setState("offline");
        reject(new Error("relay closed before auth"));
      };
      ws.onerror = () => this.setState("offline");
    });
  }

  disconnect(): void {
    this.stopHeartbeat();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close();
    }
    this.setState("offline");
  }

  // ---- contract frames ----

  invite(
    toUserId: string,
    opts: { ttlSeconds?: number; burnOnRead?: boolean; strict?: boolean } = {},
  ): void {
    this.send("relay.invite", {
      toUserId,
      ttlSeconds: opts.ttlSeconds ?? 600,
      burnOnRead: opts.burnOnRead ?? false,
      strict: opts.strict ?? false,
    });
  }

  accept(sessionId: string): void {
    this.send("relay.accept", { sessionId });
  }
  decline(sessionId: string): void {
    this.send("relay.decline", { sessionId });
  }
  sendEnvelope(sessionId: string, blob: string): void {
    this.send("relay.send", { sessionId, blob });
  }
  resume(sessionId: string, resumeToken: string): void {
    this.send("relay.resume", { sessionId, resumeToken });
  }
  burn(sessionId: string): void {
    this.send("relay.burn", { sessionId });
  }
  ping(): void {
    this.send("ping", {});
  }

  on<T extends RelayEvent["type"]>(
    type: T,
    cb: (ev: Extract<RelayEvent, { type: T }>) => void,
  ): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const fn = cb as (ev: RelayEvent) => void;
    set.add(fn);
    return () => set.delete(fn);
  }

  onStateChange(cb: (s: ConnState) => void): () => void {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private send(type: string, data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }

  private dispatch(ev: RelayEvent): void {
    for (const cb of this.listeners.get(ev.type) ?? []) cb(ev);
  }

  private setState(s: ConnState): void {
    for (const cb of this.stateCbs) cb(s);
  }
}
