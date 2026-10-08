// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

<!-- S11 private session setup — pwa-dev only. -->

<script setup lang="ts">
import { computed, ref } from "vue";
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

const TTL_OPTIONS = [
  { label: "5 min", value: 300 },
  { label: "15 min", value: 900 },
  { label: "1 hour", value: 3600 },
];
const ttl = ref(900);
const burnOnRead = ref(false);
const strict = ref(false);

function start() {
  if (!peer.value) return;
  priv.startInvite(peer.value, {
    ttlSeconds: ttl.value,
    burnOnRead: burnOnRead.value,
    strict: strict.value,
  });
  router.push({ name: "s10-private-invite", params: { chatId: chatId.value } });
}
</script>

<template>
  <main class="private-mode flex min-h-dvh flex-col px-6 pt-8">
    <button class="self-start p-1 text-muted" aria-label="back" @click="router.back()">
      <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2">
        <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
      </svg>
    </button>

    <h1 class="mt-6 text-name text-ink">private session</h1>
    <p class="mt-1 text-meta text-muted">
      with {{ peer?.displayName ?? "peer" }} — ephemeral, blind-relayed,
      verifiable via fingerprint. Nothing is written to the server.
    </p>

    <!-- session lifetime -->
    <div class="mt-8 text-sub text-muted">session lifetime</div>
    <div class="mt-2 flex gap-2">
      <button
        v-for="o in TTL_OPTIONS"
        :key="o.value"
        class="h-10 rounded-pill px-5 text-meta"
        :class="ttl === o.value ? 'bg-ink text-bg' : 'bg-bubble-in text-ink'"
        :data-testid="`ttl-${o.value}`"
        @click="ttl = o.value"
      >
        {{ o.label }}
      </button>
    </div>

    <!-- flags -->
    <label class="mt-6 flex items-center gap-3">
      <input v-model="burnOnRead" type="checkbox" class="size-4 accent-current" data-testid="opt-burn" />
      <span class="text-msg text-ink">burn on read
        <span class="text-meta text-muted">— messages die after the peer reads them</span>
      </span>
    </label>
    <label class="mt-3 flex items-center gap-3">
      <input v-model="strict" type="checkbox" class="size-4 accent-current" data-testid="opt-strict" />
      <span class="text-msg text-ink">strict mode
        <span class="text-meta text-muted">— any disconnect kills the session instantly</span>
      </span>
    </label>

    <button
      class="mt-10 h-12 rounded-pill bg-ink text-msg text-bg disabled:opacity-40"
      :disabled="!peer || priv.relayState !== 'online'"
      data-testid="start-private"
      @click="start"
    >
      {{ priv.relayState === "online" ? "send private invite" : "relay offline — live backend required" }}
    </button>
    <p class="mt-4 text-center text-micro text-muted">
      dev host — keys live in this browser's memory only
    </p>
  </main>
</template>
