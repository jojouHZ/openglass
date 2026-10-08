// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Private-layer lifecycle wiring — pwa-dev only (VITE_PRIVATE_MODULE=1).
// Extracted from main.ts so the pagehide/logout teardown contract is
// unit-testable without booting the whole app.

import { watch } from "vue";

import type { usePrivateStore } from "@openglass/core/private/store";

type SessionLike = { authed: boolean };
type PrivateLike = Pick<
  ReturnType<typeof usePrivateStore>,
  "connect" | "teardown"
>;

/** Connect the relay while authed; wipe all private state on logout and
 *  on pagehide (the browser kills the tab — fire-and-forget teardown). */
export function wirePrivateLifecycle(
  priv: PrivateLike,
  session: SessionLike,
): void {
  watch(
    () => session.authed,
    (authed) => {
      if (authed) priv.connect();
      else void priv.teardown();
    },
    { immediate: true },
  );
  addEventListener("pagehide", () => void priv.teardown());
}
