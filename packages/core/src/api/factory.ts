// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { ApiClient } from "./client";

export type ApiMode = "mock" | "live";

export interface CreateApiOptions {
  mode: ApiMode;
  /** Base URL for REST, e.g. "/api/v1" (dev proxy) or absolute origin. */
  baseUrl: string;
  /** WebSocket URL, e.g. "/api/v1/ws" — relative means same origin. */
  wsUrl: string;
  /** Loads the private remote module — pwa-dev host only. */
  privateModule?: boolean;
}

/**
 * Create the API client for the current build mode.
 * `mock` — MSW + fixtures (issue #9); `live` — real backend.
 * Implementations are interchangeable by contract, not by flags in
 * feature code.
 */
export async function createApiClient(opts: CreateApiOptions): Promise<ApiClient> {
  if (opts.mode === "mock") {
    const { createMockApiClient } = await import("./mock/index");
    return createMockApiClient(opts);
  }
  const { createHttpApiClient } = await import("./http/index");
  return createHttpApiClient(opts);
}
