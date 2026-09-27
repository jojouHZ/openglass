// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { ApiClient } from "../client";
import type { CreateApiOptions } from "../factory";

/**
 * HttpApiClient + WsClient — real backend transport.
 * Lands when the backend skeleton (#12) serves the contract.
 */
export function createHttpApiClient(_opts: CreateApiOptions): ApiClient {
  throw new Error(
    "HttpApiClient is not implemented yet — lands with the backend skeleton (#12)",
  );
}
