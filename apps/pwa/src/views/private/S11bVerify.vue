// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

<!-- S11b fingerprint verification — pwa-dev only.
     The emoji grid IS the MITM defense: without comparing it out-of-band
     the session is confidential only against a passive server. -->

<script setup lang="ts">
import { computed } from "vue";
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

function confirm() {
  if (!session.value) return;
  priv.markVerified(session.value.id);
  router.replace({ name: "s12-private-chat", params: { chatId: chatId.value } });
}

function notMatching() {
  if (session.value) priv.burn(session.value.id);
  router.replace({ name: "s5-chat-view", params: { chatId: chatId.value } });
}
</script>

<template>
  <main class="private-mode flex min-h-dvh flex-col px-6 pt-8">
    <button class="self-start p-1 text-muted" aria-label="back" @click="router.back()">
      <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2">
        <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
      </svg>
    </button>

    <h1 class="mt-6 text-name text-ink">verify fingerprint</h1>
    <p class="mt-1 text-meta text-muted">
      compare this grid with {{ peer?.displayName ?? "peer" }} —
      over a call, in person, or any channel you already trust.
    </p>

    <!-- emoji SAS grid -->
    <div
      v-if="session?.sas"
      class="mx-auto mt-10 grid grid-cols-4 gap-3"
      data-testid="sas-grid"
    >
      <span v-for="(e, i) in session.sas" :key="i" class="text-3xl">{{ e }}</span>
    </div>
    <div v-else class="mt-10 text-center text-meta text-muted" data-testid="sas-waiting">
      exchanging keys…
    </div>

    <p class="mt-8 text-center text-meta text-danger" data-testid="sas-warning">
      without this check the server could sit between you — verified only
      when the emojis match on both sides
    </p>

    <div class="mt-auto flex gap-3 pb-10">
      <button
        class="h-12 flex-1 rounded-pill border border-line text-msg text-muted"
        data-testid="sas-mismatch"
        @click="notMatching"
      >
        doesn't match
      </button>
      <button
        class="h-12 flex-1 rounded-pill bg-ink text-msg text-bg disabled:opacity-40"
        :disabled="!session?.sas"
        data-testid="sas-confirm"
        @click="confirm"
      >
        verified
      </button>
    </div>
  </main>
</template>
