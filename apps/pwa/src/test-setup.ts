// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Component tests wait for lazy route chunks, portals and animations with
// vi.waitFor. Its built-in 1s budget is enough on an idle machine but flaky
// under load (a cold start, parallel workers, CI), so give every wait a
// 5s budget unless a test sets its own. The wait still returns as soon as
// the condition holds, so passing runs are not slower.

import { vi } from "vitest";

// Mocked API round-trips take 5ms instead of the dev default of 80ms: a
// click -> request -> refetch -> render chain then needs ~20ms, so the
// fixed settle times in the specs have a large margin under load.
(globalThis as { __OG_MOCK_LATENCY_MS__?: number }).__OG_MOCK_LATENCY_MS__ = 5;

const WAIT_BUDGET_MS = 5000;
const waitFor = vi.waitFor.bind(vi);

vi.waitFor = ((callback, options) =>
  waitFor(
    callback,
    typeof options === "number"
      ? options
      : { timeout: WAIT_BUDGET_MS, ...options },
  )) as typeof vi.waitFor;
