// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { computed } from "vue";

import type { ChatSummary } from "@openglass/core";
import { useChatsStore } from "@openglass/core";

const props = defineProps<{ chat: ChatSummary }>();
const emit = defineEmits<{ open: [] }>();

const chats = useChatsStore();

const saved = computed(() => chats.isSaved(props.chat));
const title = computed(() => chats.chatTitle(props.chat));
const typing = computed(() => !!chats.typingIn(props.chat.id));

const preview = computed(() => {
  const m = props.chat.lastMessage;
  if (!m) return "";
  return m.text ?? "[attachment]";
});

const time = computed(() => {
  const ts = props.chat.lastActivityAt;
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
});
</script>

<template>
  <button
    class="flex w-full items-center gap-3 px-6 py-3 text-left hover:bg-canvas"
    data-testid="chat-item"
    @click="emit('open')"
  >
    <span
      class="grid size-[52px] shrink-0 place-items-center rounded-full bg-bubble-in text-muted"
    >
      <!-- saved messages: bookmark glyph instead of initials -->
      <svg v-if="saved" viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2">
        <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
      </svg>
      <span v-else class="text-name">{{ title.slice(0, 1) }}</span>
    </span>
    <span class="min-w-0 flex-1">
      <span class="flex items-center gap-1 text-name text-ink">
        {{ title }}
        <svg
          v-if="chat.pinned && !saved"
          viewBox="0 0 24 24"
          class="size-3 text-muted"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"
          />
        </svg>
      </span>
      <span
        v-if="typing"
        class="block truncate text-msg text-accent"
        data-testid="typing"
      >
        typing…
      </span>
      <span v-else class="block truncate text-msg text-muted" data-testid="preview">
        <span
          v-if="chat.type === 'group'"
          class="mr-1 rounded-input bg-soft px-1 text-sub text-muted"
        >group</span>{{ preview }}
      </span>
    </span>
    <span class="flex shrink-0 flex-col items-end gap-1">
      <span class="text-meta text-muted">{{ time }}</span>
      <span
        v-if="chat.unreadCount"
        class="grid min-w-5 place-items-center rounded-full bg-accent px-1.5 py-0.5 text-sub text-bg"
        data-testid="unread"
      >{{ chat.unreadCount }}</span>
    </span>
  </button>
</template>
