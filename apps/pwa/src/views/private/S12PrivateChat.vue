// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

<!-- S12 private chat — pwa-dev only. Messages live in the volatile
     private store; closing/burning/ttl-expiry wipes them for good. -->

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { useChatsStore, useSessionStore } from "@openglass/core";
import { usePrivateStore } from "@openglass/core/private/store";

import ConfirmDialog from "../../components/ConfirmDialog.vue";

const route = useRoute();
const router = useRouter();
const chats = useChatsStore();
const session = useSessionStore();
const priv = usePrivateStore();

const chatId = computed(() => String(route.params.chatId));
const chat = computed(() => chats.chats.find((c) => c.id === chatId.value));
const peer = computed(() => (chat.value?.type === "direct" ? chat.value.peer : null));
const pSession = computed(() =>
  peer.value ? priv.sessionByPeer(peer.value.id) : null,
);

// --- ttl countdown ---
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | null = null;
const ttlLeft = computed(() => {
  const t = pSession.value?.ttlEndsAt;
  if (!t) return "";
  const s = Math.max(0, Math.floor((Date.parse(t) - now.value) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
});
onMounted(() => {
  ticker = setInterval(() => (now.value = Date.now()), 1000);
});
onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker);
});

// --- composer ---
const text = ref("");
const sendError = ref("");
const scrollEl = ref<HTMLElement>();
const confirmBurn = ref(false);

async function send() {
  const t = text.value.trim();
  if (!t || !pSession.value) return;
  sendError.value = "";
  try {
    await priv.send(pSession.value.id, t);
    text.value = "";
    await nextTick();
    scrollEl.value?.scrollTo(0, scrollEl.value.scrollHeight);
  } catch {
    sendError.value = "send failed — no live session key";
  }
}

function burn() {
  confirmBurn.value = false;
  if (pSession.value) priv.burn(pSession.value.id);
  router.replace({ name: "s5-chat-view", params: { chatId: chatId.value } });
}

// session death (peer burned / ttl / revoked) → back to the public chat
watch(
  () => pSession.value,
  (s) => {
    if (!s || s.status === "closed") {
      router.replace({ name: "s5-chat-view", params: { chatId: chatId.value } });
    }
  },
);

function fmtTs(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
</script>

<template>
  <main class="private-mode relative flex h-dvh flex-col overflow-hidden">
    <!-- header -->
    <div class="flex items-center gap-3 border-b border-line/30 px-6 pb-3 pt-8">
      <button class="text-ink" aria-label="back" @click="router.back()">
        <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
        </svg>
      </button>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 text-name text-ink">
          <svg viewBox="0 0 24 24" class="size-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span class="truncate">{{ peer?.displayName ?? "private" }}</span>
          <span v-if="ttlLeft" class="text-meta text-muted" data-testid="ttl-count">{{ ttlLeft }}</span>
        </div>
        <div class="text-sub text-muted">
          <span v-if="pSession?.peerOfflineUntil" data-testid="peer-offline">
            peer offline — dies soon
          </span>
          <span v-else>ephemeral · dev host</span>
          <span
            v-if="pSession?.burnOnRead"
            class="text-burn"
            data-testid="burn-on-read"
          > · burn on read</span>
        </div>
      </div>
      <button
        class="rounded-pill bg-burn px-4 py-1.5 text-meta text-white"
        data-testid="burn-btn"
        @click="confirmBurn = true"
      >
        burn
      </button>
    </div>

    <!-- unverified banner — honest until SAS is confirmed -->
    <button
      v-if="pSession && pSession.status !== 'verified'"
      class="flex w-full items-center gap-2 bg-danger/20 px-6 py-2 text-left text-meta text-ink"
      data-testid="unverified-banner"
      @click="router.push({ name: 's11b-verify', params: { chatId } })"
    >
      <svg viewBox="0 0 24 24" class="size-4 shrink-0 text-danger" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      </svg>
      unverified — compare fingerprints to seal the channel
    </button>

    <!-- messages -->
    <div ref="scrollEl" class="min-h-0 flex-1 overflow-y-auto px-6 py-4" data-testid="priv-scroll">
      <div
        v-if="!pSession?.messages.length"
        class="py-8 text-center text-meta text-muted"
        data-testid="priv-empty"
      >
        no messages — nothing is stored, everything is encrypted
      </div>
      <div
        v-for="m in pSession?.messages ?? []"
        :key="m.id"
        class="mb-1 flex"
        :class="m.fromMe ? 'justify-end' : 'justify-start'"
      >
        <div
          class="max-w-[80%] rounded-card px-3 py-2 text-msg"
          :class="m.fromMe ? 'bg-bubble-own text-bg' : 'bg-bubble-in text-ink'"
        >
          <div class="whitespace-pre-wrap break-words">{{ m.text }}</div>
          <div class="mt-0.5 flex items-center justify-end gap-1 text-micro opacity-60">
            <span>{{ fmtTs(m.ts) }}</span>
            <svg viewBox="0 0 24 24" class="size-2.5" fill="none" stroke="currentColor" stroke-width="2.5">
              <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
        </div>
      </div>
    </div>

    <div v-if="sendError" class="px-6 pb-1 text-meta text-danger" data-testid="priv-send-error">
      {{ sendError }}
    </div>

    <!-- composer -->
    <div class="flex items-center gap-2 px-6 pb-6">
      <input
        v-model="text"
        class="h-11 min-w-0 flex-1 rounded-pill bg-bubble-in px-4 text-msg text-ink outline-none"
        :class="{ 'opacity-50': !pSession?.sessionKey }"
        :disabled="!pSession?.sessionKey"
        placeholder="private message…"
        data-testid="priv-input"
        @keyup.enter="send"
      />
      <button
        class="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-bg"
        aria-label="send"
        data-testid="priv-send"
        @click="send"
      >
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />
        </svg>
      </button>
    </div>

    <ConfirmDialog
      v-if="confirmBurn"
      title="burn this session?"
      body="messages vanish on both devices — permanently"
      confirm-label="burn"
      @confirm="burn"
      @cancel="confirmBurn = false"
    />
  </main>
</template>
