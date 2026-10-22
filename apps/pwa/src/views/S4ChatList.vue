// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { useChatsStore, useContactsStore, useSessionStore } from "@openglass/core";

import ChatListItem from "../components/chat/ChatListItem.vue";

const chats = useChatsStore();
const contacts = useContactsStore();
const session = useSessionStore();
const router = useRouter();

const sorted = computed(() =>
  [...chats.chats].sort(
    (a, b) =>
      Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
      b.lastActivityAt.localeCompare(a.lastActivityAt),
  ),
);

onMounted(async () => {
  await chats.refreshChats();
  await chats.connectRealtime().catch(() => undefined);
  // consent surfaces: pending contact requests (badge) + group invitations
  void contacts.refresh().catch(() => undefined);
  void chats.refreshInvites();
});

const inviteBusy = ref<string | null>(null);
async function answer(chatId: string, accept: boolean) {
  if (inviteBusy.value) return;
  inviteBusy.value = chatId;
  try {
    if (accept) await chats.acceptInvite(chatId);
    else await chats.declineInvite(chatId);
  } catch {
    // the invitation stays listed — user can retry
  } finally {
    inviteBusy.value = null;
  }
}

const open = (id: string) => router.push({ name: "s5-chat-view", params: { chatId: id } });
</script>

<template>
  <main class="flex h-dvh flex-col overflow-hidden">
    <div class="flex items-center gap-3 px-6 pb-4 pt-8">
      <button
        class="relative grid size-10 place-items-center text-ink"
        aria-label="new chat"
        @click="router.push({ name: 's6-contact-search' })"
      >
        <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14" />
          <path d="M12 5v14" />
        </svg>
        <span
          v-if="contacts.requestCount"
          class="absolute right-0 top-0 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-micro text-bg"
          data-testid="requests-badge"
        >{{ contacts.requestCount }}</span>
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

    <div class="flex items-center gap-4 border-b border-line px-6 pb-2 text-meta">
      <span class="text-ink underline underline-offset-4" data-testid="tab-all">all</span>
      <button
        class="ml-auto text-muted/60"
        disabled
        title="chat folders — post-MVP"
        data-testid="new-folder"
      >
        + new folder
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <!-- group invitations: not memberships — the group stays invisible
           until accepted -->
      <div v-if="chats.invites.length" class="border-b border-line" data-testid="group-invites">
        <div class="px-6 pb-1 pt-3 text-meta text-muted">
          group invitations · {{ chats.invites.length }}
        </div>
        <div
          v-for="inv in chats.invites"
          :key="inv.chatId"
          class="flex items-center gap-3 px-6 py-2"
          data-testid="group-invite"
        >
          <span class="grid size-10 shrink-0 place-items-center rounded-full bg-soft text-name text-ink">
            {{ inv.title.slice(0, 1) }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-name text-ink">{{ inv.title }}</span>
            <span class="block truncate text-meta text-muted">
              from {{ inv.inviter.displayName }} · {{ inv.memberCount }} members
            </span>
          </span>
          <button
            class="rounded-pill bg-ink px-3 py-1 text-meta text-bg disabled:opacity-40"
            :disabled="inviteBusy === inv.chatId"
            data-testid="invite-accept"
            @click="answer(inv.chatId, true)"
          >
            join
          </button>
          <button
            class="rounded-pill border border-line px-3 py-1 text-meta text-ink disabled:opacity-40"
            :disabled="inviteBusy === inv.chatId"
            data-testid="invite-decline"
            @click="answer(inv.chatId, false)"
          >
            decline
          </button>
        </div>
      </div>

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
