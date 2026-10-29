<!-- Copyright (C) 2025 OpenGlass contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<!-- App shell: chrome rows (offline strip, tab bar) are shell rows; the
     middle row holds the routed screen and is the only scroller. -->

<script setup lang="ts">
import { computed, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";

import { useChatsStore, useSessionStore } from "@openglass/core";

import TabBar from "./components/TabBar.vue";
import { pinia } from "./pinia";

const session = useSessionStore(pinia);
const chats = useChatsStore(pinia);
const route = useRoute();
const router = useRouter();

// The session can die with no navigation in flight (session.revoked
// over WS, refresh-token rejection) — the route guard only runs on
// navigation, so watch auth and bounce to the invite screen ourselves.
watch(
  () => session.authed,
  (authed) => {
    if (!authed && route.meta.auth) void router.push({ name: "s1-invite" });
  },
);

// global connectivity strip — post-auth only; S5 additionally disables
// the composer, this is the ambient "you're offline" signal elsewhere.
// wsConnected gates the offline state: before the first connectRealtime
// the store reports "offline" by default, which would flash on app open.
const offline = computed(
  () => session.authed && chats.wsConnected && chats.connState === "offline",
);
const connecting = computed(() => session.authed && chats.connState === "connecting");

// root navigation: only on root screens (route meta), never in a chat or sub-screen
const showNav = computed(() => session.authed && route.meta.nav === true);
</script>

<template>
  <div class="flex h-dvh flex-col">
    <div
      v-if="offline || connecting"
      class="pointer-events-none fixed inset-x-0 top-0 z-50 bg-bubble-in px-6 py-1.5 text-center text-meta text-muted"
      data-testid="conn-banner"
    >
      {{ offline ? "offline — reconnecting" : "connecting…" }}
    </div>
    <!-- the only scroll container of the shell; screens fill it (h-full) -->
    <div class="min-h-0 flex-1 overflow-y-auto">
      <RouterView />
    </div>
    <TabBar v-if="showNav" />
  </div>
</template>
