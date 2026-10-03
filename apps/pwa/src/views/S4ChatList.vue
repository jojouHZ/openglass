// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { useChatsStore, useSessionStore } from "@openglass/core";

import ChatListItem from "../components/chat/ChatListItem.vue";

const chats = useChatsStore();
const session = useSessionStore();
const router = useRouter();

const folder = ref<"all" | "groups" | "private">("all");
const privateModule = import.meta.env.VITE_PRIVATE_MODULE === "1";

const filtered = computed(() => {
  if (folder.value === "groups") return chats.chats.filter((c) => c.type === "group");
  // private / work folders are placeholders — no folder semantics in contract
  return chats.chats;
});

const sorted = computed(() =>
  [...filtered.value].sort(
    (a, b) =>
      Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
      b.lastActivityAt.localeCompare(a.lastActivityAt),
  ),
);

onMounted(async () => {
  await chats.refreshChats();
  await chats.connectRealtime().catch(() => undefined);
});

const open = (id: string) => router.push({ name: "s5-chat-view", params: { chatId: id } });
</script>

<template>
  <main class="flex h-dvh flex-col overflow-hidden">
    <div class="flex items-center gap-3 px-6 pb-4 pt-8">
      <button
        class="grid size-10 place-items-center text-ink"
        aria-label="new chat"
        @click="router.push({ name: 's6-contact-search' })"
      >
        <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14" />
          <path d="M12 5v14" />
        </svg>
      </button>
      <h1 class="flex-1 text-center text-header text-ink">Chats</h1>
      <button
        class="grid size-10 place-items-center rounded-full bg-bubble-in text-name text-muted"
        data-testid="avatar-to-settings"
        @click="router.push({ name: 's13-settings' })"
      >
        {{ session.user?.displayName?.slice(0, 1) ?? "?" }}
      </button>
    </div>

    <div class="flex gap-4 border-b border-line px-6 pb-2 text-meta">
      <button
        :class="folder === 'all' ? 'text-ink underline underline-offset-4' : 'text-muted'"
        data-testid="tab-all"
        @click="folder = 'all'"
      >
        all
      </button>
      <button
        v-if="privateModule"
        :class="folder === 'private' ? 'text-ink underline underline-offset-4' : 'text-muted'"
        @click="folder = 'private'"
      >
        private
      </button>
      <button
        :class="folder === 'groups' ? 'text-ink underline underline-offset-4' : 'text-muted'"
        data-testid="tab-groups"
        @click="folder = 'groups'"
      >
        groups
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <!-- refresh failed: banner + manual retry, never a false empty -->
      <div
        v-if="chats.chatsLoadError"
        class="flex items-center gap-2 border-b border-line bg-soft px-6 py-2 text-meta text-body"
        data-testid="load-error"
      >
        <span class="flex-1">couldn't refresh chats</span>
        <button class="text-accent" data-testid="chats-retry" @click="chats.refreshChats()">
          retry
        </button>
      </div>
      <div
        v-if="!sorted.length && !chats.chatsLoadError"
        class="grid h-full place-items-center px-6"
        data-testid="empty"
      >
        <div class="flex flex-col items-center gap-3 text-center">
          <svg viewBox="0 0 24 24" class="size-8 text-muted" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <div class="text-body text-ink">no chats yet</div>
          <div class="text-meta text-muted">find people by tag to start</div>
          <button
            class="mt-1 h-11 rounded-pill bg-ink px-6 text-msg text-bg"
            @click="router.push({ name: 's6-contact-search' })"
          >
            find contacts
          </button>
        </div>
      </div>
      <template v-else>
        <ChatListItem
          v-for="c in sorted"
          :key="c.id"
          :chat="c"
          @open="open(c.id)"
        />
      </template>
    </div>
  </main>
</template>
