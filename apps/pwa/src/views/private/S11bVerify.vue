// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

<!-- S11b fingerprint verification — pwa-dev only.
     The symbol row + digit code IS the MITM defense: without comparing it
     out-of-band the session is confidential only against a passive server. -->

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";

import { useChatsStore } from "@openglass/core";

import { usePrivateRemote, usePrivateSession } from "../../privateRemote";
import { SAS_OBJECTS } from "../../private/sasSymbols";
import "../../styles/private.css";

const route = useRoute();
const router = useRouter();
const chats = useChatsStore();
const remote = usePrivateRemote();

const chatId = computed(() => String(route.params.chatId));
const chat = computed(() => chats.chats.find((c) => c.id === chatId.value));
const peer = computed(() => (chat.value?.type === "direct" ? chat.value.peer : null));

const session = usePrivateSession(() => peer.value?.id);

function confirm() {
  if (!session.value) return;
  remote.confirmSas(session.value.sessionId);
  router.replace({ name: "s12-private-chat", params: { chatId: chatId.value } });
}

function notMatching() {
  if (session.value) remote.burn(session.value.sessionId);
  router.replace({ name: "s5-chat-view", params: { chatId: chatId.value } });
}
</script>

<template>
  <main class="private-mode flex min-h-full flex-col px-6 pt-8">
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

    <!-- SAS: six nameable objects + six digits — identical SVG on both
         sides; spoken comparison is "cat train orange …" not emoji mime -->
    <div v-if="session?.sas" class="mx-auto mt-10" data-testid="sas-grid">
      <div class="grid grid-cols-3 gap-x-8 gap-y-5">
        <div
          v-for="(idx, i) in session.sas.symbols"
          :key="i"
          class="flex w-16 flex-col items-center gap-1"
        >
          <component
            :is="SAS_OBJECTS[idx].icon"
            class="size-8 text-ink"
            :stroke-width="1.75"
          />
          <span class="text-micro text-muted">{{ SAS_OBJECTS[idx].label }}</span>
        </div>
      </div>
      <div
        class="mt-6 text-center font-mono text-2xl tracking-[0.4em] text-ink"
        data-testid="sas-digits"
      >
        {{ session.sas.digits }}
      </div>
    </div>
    <div v-else class="mt-10 text-center text-meta text-muted" data-testid="sas-waiting">
      exchanging keys…
    </div>

    <p class="mt-8 text-center text-meta text-danger" data-testid="sas-warning">
      without this check the server could sit between you — verified only
      when the objects and digits match on both sides
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
        class="h-12 flex-1 rounded-pill bg-primary text-msg text-primary-foreground disabled:opacity-40"
        :disabled="!session?.sas"
        data-testid="sas-confirm"
        @click="confirm"
      >
        verified
      </button>
    </div>
  </main>
</template>
