// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Node entry — vitest/SSR. Keeps msw/node out of the browser bundle.

import { setupServer, type SetupServer } from "msw/node";

import type { ApiClient } from "../client";
import type { CreateApiOptions } from "../factory";
import { HttpApiClient } from "../http";
import { createHandlers } from "./handlers";
import { MockState } from "./state";
import { MockWsClient } from "./ws";

export interface MockNodeContext {
  api: ApiClient;
  server: SetupServer;
  state: MockState;
  /** Resolves once no mocked request is in flight and none has started or
   *  finished for a short quiet window — lets tests wait for the network
   *  instead of a fixed sleep. */
  idle(): Promise<void>;
}

export function createMockNodeApiClient(opts: CreateApiOptions): MockNodeContext {
  const state = new MockState();
  const server = setupServer(...createHandlers(state));
  server.listen({ onUnhandledFrame: "bypass" });
  const api = new HttpApiClient(opts, new MockWsClient(state));

  // idle() = nothing in flight AND no request started or finished for a
  // short quiet window: a handler that issues its request a few ms late
  // (a slow core, a busy event loop) must not slip past the check
  let inFlight = 0;
  let lastEvent = 0;
  server.events.on("request:start", () => {
    inFlight++;
    lastEvent = Date.now();
  });
  server.events.on("request:end", () => {
    inFlight = Math.max(0, inFlight - 1);
    lastEvent = Date.now();
  });
  const QUIET_MS = 150;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const idle = async () => {
    const deadline = Date.now() + 5000;
    do await sleep(25);
    while ((inFlight > 0 || Date.now() - lastEvent < QUIET_MS) && Date.now() < deadline);
  };
  return { api, server, state, idle };
}
