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
  /** Resolves once no mocked request is in flight (and stays quiet for a
   *  moment) — lets tests wait for the network instead of a fixed sleep. */
  idle(): Promise<void>;
}

export function createMockNodeApiClient(opts: CreateApiOptions): MockNodeContext {
  const state = new MockState();
  const server = setupServer(...createHandlers(state));
  server.listen({ onUnhandledFrame: "bypass" });
  const api = new HttpApiClient(opts, new MockWsClient(state));

  let inFlight = 0;
  server.events.on("request:start", () => void inFlight++);
  server.events.on("request:end", () => void Math.max(0, inFlight--));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const idle = async () => {
    const deadline = Date.now() + 5000;
    do await sleep(25);
    while (inFlight > 0 && Date.now() < deadline);
    await sleep(25);
  };
  return { api, server, state, idle };
}
