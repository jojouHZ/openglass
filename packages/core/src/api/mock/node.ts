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
}

export function createMockNodeApiClient(opts: CreateApiOptions): MockNodeContext {
  const state = new MockState();
  const server = setupServer(...createHandlers(state));
  server.listen({ onUnhandledRequest: "bypass" });
  const api = new HttpApiClient(opts, new MockWsClient(state));
  return { api, server, state };
}
