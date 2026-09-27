// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Mock mode = real HttpApiClient + MSW answering its requests.
// This entry is browser-only (service worker). Node/test usage lives
// in ./node so msw/node never enters the browser bundle.

import type { ApiClient } from "../client";
import type { CreateApiOptions } from "../factory";
import { HttpApiClient } from "../http";
import { createHandlers } from "./handlers";
import { MockState } from "./state";
import { MockWsClient } from "./ws";

export { MockState } from "./state";
export { createHandlers } from "./handlers";
export { MockWsClient, demoScenario } from "./ws";
export type { ScenarioStep } from "./ws";
export * as fixtures from "./fixtures";

export async function createMockApiClient(opts: CreateApiOptions): Promise<ApiClient> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    throw new Error(
      "createMockApiClient is browser-only — use ./node entry for tests/node",
    );
  }
  const state = new MockState();
  const { setupWorker } = await import("msw/browser");
  const worker = setupWorker(...createHandlers(state));
  await worker.start({ onUnhandledRequest: "bypass" });
  return new HttpApiClient(opts, new MockWsClient(state));
}
