// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { ApiRequestError } from "@openglass/core";

/**
 * Map an API error to an inline message. `map` overrides by code;
 * unmatched contract codes fall through to the server message.
 */
export function apiErrorMessage(e: unknown, map: Record<string, string> = {}): string {
  if (e instanceof ApiRequestError) {
    return map[e.apiError.code] ?? e.apiError.message;
  }
  return "Network error — check your connection";
}

export function apiErrorDetails(e: unknown): Record<string, unknown> | undefined {
  return e instanceof ApiRequestError ? e.apiError.details : undefined;
}
