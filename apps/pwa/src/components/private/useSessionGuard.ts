// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { computed, onBeforeUnmount, ref, shallowRef } from "vue";

import { useChatsStore } from "@openglass/core";
import type { PrivateSessionView } from "@openglass/core/private/remote";

import { usePrivateRemote } from "../../privateRemote";

/**
 * One private connection per client — shared guard for the private
 * surface and the invite card. `requestOrConfirm(run)` runs immediately
 * when no other session is live, or parks `run` behind the confirm
 * dialog; `confirmSwitch` burns the previous session, then runs it.
 *
 * Only a real connection counts (exchanging keys or later): pending
 * invites never block — the store auto-declines them busy, so an
 * unanswered invite cannot lock the owner out of private messaging.
 */
const LIVE = new Set(["exchanging", "unverified", "verified"]);

export function useSessionGuard(peerId: () => string) {
  const remote = usePrivateRemote();
  const chats = useChatsStore();
  const activeSessions = shallowRef<readonly PrivateSessionView[]>([]);
  const pendingSwitch = ref<{ burnSessionId: string; run: () => void } | null>(null);
  const otherLive = computed(() =>
    activeSessions.value.find((s) => s.peerId !== peerId() && LIVE.has(s.status)),
  );
  const otherLiveName = computed(() => {
    const other = otherLive.value;
    if (!other) return "";
    const chat = chats.chats.find((c) => c.type === "direct" && c.peer?.id === other.peerId);
    return chat ? chats.chatTitle(chat) : "another chat";
  });
  function requestOrConfirm(run: () => void) {
    if (otherLive.value) pendingSwitch.value = { burnSessionId: otherLive.value.sessionId, run };
    else run();
  }
  function confirmSwitch() {
    const pending = pendingSwitch.value;
    pendingSwitch.value = null;
    if (!pending) return;
    remote.burn(pending.burnSessionId);
    pending.run();
  }
  const stop = remote.watchActiveSessions((views) => (activeSessions.value = views));
  onBeforeUnmount(stop);
  return { pendingSwitch, otherLiveName, requestOrConfirm, confirmSwitch };
}
