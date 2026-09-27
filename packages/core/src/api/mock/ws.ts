// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// MockWsClient — a scripted event PLAYER, not a hub.
// connect() → auth.ok → presence.snapshot → optional scenario steps on
// fixed delays. No ordering engine, no ordering guarantees, no TTL —
// scenarios exist for demo/GIF capture only (per FDD).

import type { ApiEvents, Unsubscribe } from "../client";
import type { ServerEvent } from "../events";
import type { MockState } from "./state";
import { wife } from "./fixtures";

type ConnState = "connecting" | "online" | "offline";

export interface ScenarioStep {
  /** ms after connect */
  at: number;
  type: ServerEvent["type"];
  data: unknown;
}

/** Default demo script: wife is typing, then one message lands. */
export function demoScenario(state: MockState, chatId: string): ScenarioStep[] {
  const seq = state.nextSeq(chatId);
  const ts = () => new Date().toISOString();
  const msg = {
    id: `ws-demo-${seq}`,
    chatId,
    seq,
    senderId: wife.id,
    text: "psst — this came over the (mock) websocket",
    clientNonce: `ws-demo-${seq}`,
    sentAt: ts(),
    pinned: false,
  };
  return [
    { at: 1500, type: "typing", data: { chatId, userId: wife.id, until: ts() } },
    { at: 3000, type: "message.new", data: msg },
    { at: 4500, type: "receipt.read", data: { chatId, userId: wife.id, upToSeq: seq } },
  ];
}

export class MockWsClient implements ApiEvents {
  private listeners = new Map<string, Set<(ev: ServerEvent) => void>>();
  private stateCbs = new Set<(s: ConnState) => void>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private seq = 0;
  private scenario: ScenarioStep[];

  constructor(
    state: MockState,
    scenario?: ScenarioStep[],
    chatId = "c0000000-0000-4000-8000-000000000001",
  ) {
    this.scenario = scenario ?? demoScenario(state, chatId);
  }

  connect(_accessToken: string, _lastSeq?: number): Promise<void> {
    this.setState("connecting");
    return new Promise((resolve) => {
      this.after(50, () => {
        this.emit("auth.ok", { resumedFromSeq: null });
        this.setState("online");
        resolve();
        this.after(50, () =>
          this.emit("presence.snapshot", {
            onlineUserIds: [wife.id],
          }),
        );
        for (const step of this.scenario) {
          this.after(step.at, () => this.emit(step.type, step.data));
        }
      });
    });
  }

  disconnect(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
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

  typingStart(): void {}
  typingStop(): void {}
  receiptRead(): void {}
  ping(): void {
    this.emit("pong", {});
  }

  private after(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms));
  }

  private emit(type: ServerEvent["type"], data: unknown): void {
    const ev = {
      type,
      seq: ++this.seq,
      ts: new Date().toISOString(),
      data,
    } as ServerEvent;
    for (const cb of this.listeners.get(type) ?? []) cb(ev);
  }

  private setState(s: ConnState): void {
    for (const cb of this.stateCbs) cb(s);
  }
}
