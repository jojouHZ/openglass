<!-- Copyright (C) 2025 OpenGlass contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<!-- App shell: mobile grid rows per docs/ux/design-tokens.md —
     chrome rows (header/nav) are shell rows, only the 1fr row scrolls. -->

<script setup lang="ts">
import { computed } from "vue";
import { RouterView } from "vue-router";

import { useChatsStore, useSessionStore } from "@openglass/core";

import { pinia } from "./pinia";

const session = useSessionStore(pinia);
const chats = useChatsStore(pinia);

// global connectivity strip — post-auth only; S5 additionally disables
// the composer, this is the ambient "you're offline" signal elsewhere.
// wsConnected gates the offline state: before the first connectRealtime
// the store reports "offline" by default, which would flash on app open.
const offline = computed(
  () => session.authed && chats.wsConnected && chats.connState === "offline",
);
const connecting = computed(() => session.authed && chats.connState === "connecting");
</script>

<template>
  <div class="grid min-h-dvh grid-rows-[auto_1fr_auto]">
    <div
      v-if="offline || connecting"
      class="pointer-events-none fixed inset-x-0 top-0 z-50 bg-bubble-in px-6 py-1.5 text-center text-meta text-muted"
      data-testid="conn-banner"
    >
      {{ offline ? "offline — reconnecting" : "connecting…" }}
    </div>
    <RouterView />
  </div>
</template>
