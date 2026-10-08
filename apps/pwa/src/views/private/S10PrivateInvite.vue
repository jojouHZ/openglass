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
/** the invitee view needs THE incoming invite, not the best-ranked
 *  session — a live session may coexist with a stray second invite */
const incoming = computed(() =>
  priv.incomingInvites.find((s) => s.peer.id === peer.value?.id) ?? null,
);

// "gone" = the session object vanished — peer declined, invite expired,
// or teardown wiped it. Status mutations arrive in-place, deletion
// swaps the ref to null — watch the derived status so both fire.
watch(
  () => session.value?.status ?? "gone",
  (st) => {
    if (st === "unverified" || st === "verified") {
      router.replace({ name: "s11b-verify", params: { chatId: chatId.value } });
    } else if (st === "gone" || st === "closed") {
      router.replace({ name: "s5-chat-view", params: { chatId: chatId.value } });
    }
  },
);

function cancel() {
  // no cancel frame in the relay contract — the server-side invite dies
  // on its TTL; we just drop our local pending marker. If the server
  // already acked (inviting session exists) leave it to expire.
  if (peer.value) priv.pendingInvites.delete(peer.value.id);
  router.push({ name: "s5-chat-view", params: { chatId: chatId.value } });
}

function accept() {
  if (incoming.value) priv.accept(incoming.value.id);
}
function declineIncoming() {
  if (incoming.value) priv.decline(incoming.value.id); // drops the session
}
</script>

<template>
  <main class="private-mode grid min-h-dvh place-items-center px-6">
    <!-- incoming invite — we are the invitee -->
    <div
      v-if="incoming"
      class="flex flex-col items-center gap-4 text-center"
      data-testid="invite-incoming"
    >
      <svg viewBox="0 0 24 24" class="size-10 text-accent" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      <div class="text-name text-ink">
        {{ peer?.displayName ?? "peer" }} invites you to a private session
      </div>
      <div class="max-w-64 text-meta text-muted">
        ephemeral · encrypted after fingerprint verify · leaves no trace
      </div>
      <div class="mt-2 flex gap-3">
        <button
          class="rounded-pill px-6 py-2 text-meta text-muted"
          data-testid="invite-decline"
          @click="declineIncoming"
        >
          decline
        </button>
        <button
          class="rounded-pill bg-ink px-6 py-2 text-meta text-bg"
          data-testid="invite-accept"
          @click="accept"
        >
          accept
        </button>
      </div>
    </div>

    <!-- outgoing invite — waiting for the peer -->
    <div v-else class="flex flex-col items-center gap-4 text-center">
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
