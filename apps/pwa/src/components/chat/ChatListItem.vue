// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { computed } from "vue";
import { Bookmark, Users, VenetianMask } from "lucide-vue-next";

import type { ChatSummary } from "@openglass/core";
import { useChatsStore, useSessionStore } from "@openglass/core";

import Avatar from "../ui/Avatar.vue";

const props = defineProps<{ chat: ChatSummary; privateActive?: boolean; privateInvite?: boolean }>();
const emit = defineEmits<{ open: [] }>();

const chats = useChatsStore();
const session = useSessionStore();

const saved = computed(() => chats.isSaved(props.chat));
const isGroup = computed(() => props.chat.type === "group");
// colour seed: the peer's tag for a direct chat, the title for a group
const seed = computed(() => (props.chat.type === "direct" && props.chat.peer?.tag) || title.value);
const title = computed(() => chats.chatTitle(props.chat));
const typing = computed(() => !!chats.typingIn(props.chat.id));

const preview = computed(() => {
  const m = props.chat.lastMessage;
  if (!m) return "";
  if (m.kind === "system") return "contact removed";
  return m.text ?? "[attachment]";
});

// Telegram-style "you: " prefix on own outgoing last message.
const ownLast = computed(
  () =>
    !!props.chat.lastMessage &&
    props.chat.lastMessage.kind !== "system" &&
    props.chat.lastMessage.senderId === session.user?.id,
);

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
    <span class="relative shrink-0">
      <!-- saved messages: bookmark glyph, not initials -->
      <span
        v-if="saved"
        class="grid size-12 place-items-center rounded-full bg-soft text-primary"
        data-testid="saved-avatar"
      >
        <Bookmark class="size-5" :stroke-width="1.75" />
      </span>
      <Avatar v-else :name="title" :tag="seed" class="!size-12" />
      <span
        v-if="isGroup"
        class="absolute -bottom-0.5 -right-0.5 grid size-5 place-items-center rounded-full border-2 border-bg bg-neutral text-neutral-fg"
        data-testid="group-badge"
      >
        <Users class="size-2.5" :stroke-width="2.25" />
      </span>
      <!-- incoming/missed private invite — mask glyph on the left,
           opposite the unread counter on the right -->
      <span
        v-if="privateInvite"
        class="absolute -bottom-0.5 -left-0.5 grid size-5 place-items-center rounded-full border-2 border-bg bg-pv text-pv-fg"
        data-testid="private-invite-badge"
        title="private session invite"
      >
        <VenetianMask class="size-2.5" :stroke-width="2.25" />
      </span>
    </span>
    <span class="min-w-0 flex-1">
      <span class="block truncate text-name font-semibold text-ink">
        {{ title }}
        <span
          v-if="privateActive"
          class="ml-1 inline-flex translate-y-[-1px] items-center gap-0.5 rounded-pill bg-pv px-1.5 py-0.5 align-middle text-micro font-normal text-pv-fg"
          data-testid="private-chip"
          title="private session"
        >
          <svg viewBox="0 0 24 24" class="size-2.5" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          private
        </span>
      </span>
      <span v-if="typing" class="block truncate text-msg text-primary" data-testid="typing">
        typing…
      </span>
      <span v-else class="block truncate text-msg text-muted" data-testid="preview">
        <span v-if="ownLast" class="text-ink/70">you: </span>{{ preview }}
      </span>
    </span>
    <span class="flex shrink-0 flex-col items-end gap-1">
      <span class="text-meta text-muted">{{ time }}</span>
      <span class="flex items-center gap-1.5">
        <svg
          v-if="chat.pinned && !chat.unreadCount"
          viewBox="0 0 24 24"
          class="size-3 text-muted"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-label="pinned"
        >
          <path
            d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"
          />
        </svg>
        <span
          v-if="chat.unreadCount"
          class="grid min-w-5 place-items-center rounded-full bg-primary px-1.5 py-0.5 text-sub font-semibold text-primary-foreground"
          data-testid="unread"
        >{{ chat.unreadCount }}</span>
      </span>
    </span>
  </button>
</template>
