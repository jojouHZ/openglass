// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Private-layer remote injection — the ONLY contract between the PWA
// host and the private core module. Views subscribe to immutable
// snapshots and send commands; they never import `usePrivateStore`.
//
// This file is bundle-safe for the mvp build: it imports only the public
// PRIVATE_REMOTE_KEY plus erased type-only imports — no private-module
// runtime code enters the bundle graph.

import { inject, onBeforeUnmount, ref, watch, type Ref } from "vue";

import { PRIVATE_REMOTE_KEY } from "@openglass/core";
import type {
  PrivateRemote,
  PrivateSessionView,
} from "@openglass/core/private/remote";

/** Private views — absent remote is a wiring bug, fail loudly. */
export function usePrivateRemote(): PrivateRemote {
  const remote = inject<PrivateRemote | null>(PRIVATE_REMOTE_KEY, null);
  if (!remote) {
    throw new Error(
      "private remote unavailable — requires VITE_PRIVATE_MODULE=1 live mode",
    );
  }
  return remote;
}

/** Public screens (S5) — the private module may legitimately be absent
 *  in the mvp build, so the remote is nullable here. */
export function injectPrivateRemote(): PrivateRemote | null {
  return inject<PrivateRemote | null>(PRIVATE_REMOTE_KEY, null);
}

/** Subscribe a component to a peer's session view — returns a host-owned
 *  ref updated on every remote emission; auto-unsubscribes on unmount
 *  and resubscribes when the peer changes. */
export function usePrivateSession(
  getPeerId: () => string | null | undefined,
): Readonly<Ref<PrivateSessionView | null>> {
  const remote = usePrivateRemote();
  const view = ref<PrivateSessionView | null>(null);
  let stop: (() => void) | null = null;
  watch(
    getPeerId,
    (peerId) => {
      stop?.();
      stop = null;
      view.value = null;
      if (peerId) {
        stop = remote.watchSession(peerId, (v) => {
          view.value = v;
        });
      }
    },
    { immediate: true },
  );
  onBeforeUnmount(() => stop?.());
  return view;
}
