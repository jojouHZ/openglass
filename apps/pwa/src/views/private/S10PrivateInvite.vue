// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

<!-- S10 private invite — the inviter's "waiting for peer" state.
     pwa-dev only. Auto-advances to S11b when the session is live. -->

<script setup lang="ts">
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { useChatsStore } from "@openglass/core";
import { usePrivateStore } from "@openglass/core/private/store";

const route = useRoute();
const router = useRouter();
const chats = useChatsStore();
const priv = usePrivateStore();

const chatId = computed(() => String(route.params.chatId));
const chat = computed(() => chats.chats.find((c) => c.id === chatId.value));
const peer = computed(() => (chat.value?.type === "direct" ? chat.value.peer : null));

const session = computed(() =>
  peer.value ? priv.sessionByPeer(peer.value.id) : null,
);

// accept → key exchange → unverified: go verify the fingerprint
watch(
  () => session.value?.status,
  (st) => {
    if (st === "unverified" || st === "verified") {
      router.replace({ name: "s11b-verify", params: { chatId: chatId.value } });
    }
    if (st === "closed") {
      router.replace({ name: "s5-chat-view", params: { chatId: chatId.value } });
    }
  },
);

function cancel() {
  // no cancel frame in the relay contract — the server-side invite dies
  // on its TTL; we just drop our local pending marker
  if (peer.value) priv.pendingInvites.delete(peer.value.id);
  router.push({ name: "s5-chat-view", params: { chatId: chatId.value } });
}
</script>

<template>
  <main class="private-mode grid min-h-dvh place-items-center px-6">
    <div class="flex flex-col items-center gap-4 text-center">
      <svg
        viewBox="0 0 24 24"
        class="size-10 animate-pulse text-accent"
        fill="none" stroke="currentColor" stroke-width="1.5"
      >
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      <div class="text-name text-ink" data-testid="invite-waiting">
        waiting for {{ peer?.displayName ?? "peer" }}…
      </div>
      <div class="max-w-64 text-meta text-muted">
        the invite expires if they don't answer; nothing is stored
      </div>
      <button
        class="mt-2 rounded-pill px-6 py-2 text-meta text-muted"
        data-testid="invite-cancel"
        @click="cancel"
      >
        cancel
      </button>
    </div>
  </main>
</template>
