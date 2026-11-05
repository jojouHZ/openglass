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
type PrivateLike = Pick<PrivateRemote, "connect" | "stop" | "teardown">;

/** Connect the relay while authed; forget device trust on actual logout.
 *  Pagehide stops volatile state without deleting identity and pins. */
export function wirePrivateLifecycle(
  priv: PrivateLike,
  session: SessionLike,
): void {
  watch(
    () => session.authed,
    (authed, wasAuthed) => {
      if (authed) priv.connect();
      else if (wasAuthed) void priv.teardown();
      else priv.stop();
    },
    { immediate: true },
  );
  addEventListener("pagehide", () => priv.stop());
}
