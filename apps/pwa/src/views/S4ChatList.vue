// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { useRouter } from "vue-router";
import { Plus, Search } from "lucide-vue-next";

import { useChatsStore, useContactsStore, useSessionStore } from "@openglass/core";
import type { PrivateSessionView } from "@openglass/core/private/remote";

import ChatListItem from "../components/chat/ChatListItem.vue";
import Avatar from "../components/ui/Avatar.vue";
import { injectPrivateRemote } from "../privateRemote";

const chats = useChatsStore();
const contacts = useContactsStore();
const session = useSessionStore();
const router = useRouter();

const q = ref("");

const sorted = computed(() =>
  [...chats.chats]
    // local filter by title — no server round-trip, nothing invented
    .filter((c) => !q.value.trim() || chats.chatTitle(c).toLowerCase().includes(q.value.trim().toLowerCase()))
    .sort(
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

// F2 — "private" chip on chats with a live private session (pwa-dev only;
// the remote is null in the mvp build and this stays empty)
const privatePeers = shallowRef<ReadonlySet<string>>(new Set());
const privateRemote = injectPrivateRemote();
let stopActiveWatch: (() => void) | null = null;
onMounted(() => {
  if (privateRemote) {
    stopActiveWatch = privateRemote.watchActiveSessions((views: PrivateSessionView[]) => {
      privatePeers.value = new Set(views.map((v) => v.peerId));
    });
  }
});
onBeforeUnmount(() => stopActiveWatch?.());
</script>

<template>
  <main class="flex h-full flex-col overflow-hidden">
    <div class="flex items-center gap-3 px-6 pb-3 pt-8">
      <h1 class="flex-1 text-header text-ink">Chats</h1>
      <button
        class="grid size-11 place-items-center rounded-input bg-soft text-ink"
        aria-label="new chat"
        data-testid="new-chat"
        @click="router.push({ name: 's6-contact-search' })"
      >
        <Plus class="size-5" :stroke-width="2" />
      </button>
      <button
        class="grid size-11 place-items-center rounded-full"
        aria-label="settings"
        data-testid="avatar-to-settings"
        @click="router.push({ name: 's13-settings' })"
      >
        <Avatar :name="session.user?.displayName ?? '?'" :tag="session.user?.tag" class="!size-10" />
      </button>
    </div>

    <div class="px-6 pb-3">
      <label class="flex min-h-11 items-center gap-2 rounded-input bg-soft px-3">
        <Search class="size-4 shrink-0 text-muted" :stroke-width="1.5" />
        <input
          v-model="q"
          class="w-full bg-transparent text-msg text-ink outline-none placeholder:text-muted"
          placeholder="Search chats"
          aria-label="search chats"
          data-testid="chat-search"
        />
      </label>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <!-- group invitations: not memberships — the group stays invisible
           until accepted -->
      <div v-if="chats.invites.length" class="border-b border-line" data-testid="group-invites">
        <div class="px-6 pb-1 pt-3 text-sub font-semibold uppercase tracking-wide text-muted">
          group invitations · {{ chats.invites.length }}
        </div>
        <div
          v-for="inv in chats.invites"
          :key="inv.chatId"
          class="flex items-center gap-3 px-6 py-2"
          data-testid="group-invite"
        >
          <Avatar :name="inv.title" :tag="inv.title" class="!size-10" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-name text-ink">{{ inv.title }}</span>
            <span class="block truncate text-meta text-muted">
              from {{ inv.inviter.displayName }} · {{ inv.memberCount }} members
            </span>
          </span>
          <button
            class="h-11 rounded-pill bg-primary px-4 text-meta text-primary-foreground disabled:opacity-40"
            :disabled="inviteBusy === inv.chatId"
            data-testid="invite-accept"
            @click="answer(inv.chatId, true)"
          >
            join
          </button>
          <button
            class="h-11 rounded-pill border border-line px-4 text-meta text-ink disabled:opacity-40"
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
        v-if="!sorted.length && !chats.chatsLoadError && q.trim()"
        class="grid h-full place-items-center px-6 text-center"
        data-testid="chat-search-empty"
      >
        <div class="text-meta text-muted">no chats match "{{ q.trim() }}"</div>
      </div>
      <div
        v-else-if="!sorted.length && !chats.chatsLoadError"
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
            class="mt-1 h-11 rounded-pill bg-primary px-6 text-msg text-primary-foreground"
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
          :private-active="c.type === 'direct' && !!c.peer && privatePeers.has(c.peer.id)"
          @open="open(c.id)"
        />
      </template>
    </div>
  </main>
</template>
