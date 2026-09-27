// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { ApiClient } from "../client";
import type { CreateApiOptions } from "../factory";

/**
 * MockApiClient — lands with issue #9 (MSW + typed fixtures).
 * The stub exists so the scaffold compiles and the mode switch is real.
 */
export function createMockApiClient(_opts: CreateApiOptions): ApiClient {
  throw new Error(
    "MockApiClient is not implemented yet — see issue #9 (Mock API client: MSW + typed fixtures)",
  );
}
