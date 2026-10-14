// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Private-layer lifecycle wiring — pwa-dev only (VITE_PRIVATE_MODULE=1).
// The host owns platform lifecycle and drives it through the remote
// contract; the core never touches window/document itself. Other shells
// (Capacitor pause, Electron before-quit, native suspend) map their own
// events onto the same two commands.

import { watch } from "vue";

import type { PrivateRemote } from "@openglass/core/private/remote";

type SessionLike = { authed: boolean };
type PrivateLike = Pick<PrivateRemote, "connect" | "teardown">;

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
