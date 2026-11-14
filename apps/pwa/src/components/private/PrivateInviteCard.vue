// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

<!-- Private invite card — rendered inside S5 for a DM peer.
     pwa-dev only (the route graph and this import sit behind
     VITE_PRIVATE_MODULE; the mvp bundle never sees this file). -->

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from "vue";

import type { PrivateInvitesView, PrivateSessionView } from "@openglass/core/private/remote";

import { useChatsStore } from "@openglass/core";
import { usePrivateRemote, usePrivateSession } from "../../privateRemote";
import ConfirmDialog from "../ConfirmDialog.vue";

const props = defineProps<{ peerId: string; chatId: string }>();
const emit = defineEmits<{ verify: [sessionId: string]; open: [] }>();
const remote = usePrivateRemote();
const chats = useChatsStore();

const session = usePrivateSession(() => props.peerId);
const invites = ref<PrivateInvitesView>({ incoming: [], outgoing: [] });
// rule 5 — one private session per client: accepting while another
// is live asks, then terminates the previous one
const activeSessions = shallowRef<readonly PrivateSessionView[]>([]);
const pendingSwitch = ref<{ burnSessionId: string; run: () => void } | null>(null);
const stopAll = [
  remote.watchInvites((v) => (invites.value = v)),
  remote.watchActiveSessions((v) => (activeSessions.value = v)),
];
onBeforeUnmount(() => stopAll.forEach((stop) => stop()));

/** incoming invite from this peer, or our outgoing pending invite */
const incoming = computed(() =>
  invites.value.incoming.find((i) => i.peerId === props.peerId) ?? null,
);
const outgoing = computed(() => invites.value.outgoing.includes(props.peerId));
/** a live session — past the invite phase (key exchange or later) */
const live = computed(() => {
  const s = session.value;
  return s && s.status !== "incoming" && s.status !== "inviting" ? s : null;
});

const otherLive = computed(() =>
  activeSessions.value.find((s) => s.peerId !== props.peerId && s.status !== "closed"),
);
const otherLiveName = computed(() => {
  const other = otherLive.value;
  if (!other) return "";
  const chat = chats.chats.find((c) => c.type === "direct" && c.peer?.id === other.peerId);
  return chat ? chats.chatTitle(chat) : "another chat";
});
function doAccept() {
  if (!incoming.value) return;
  remote.accept(incoming.value.sessionId);
  emit("verify", incoming.value.sessionId);
}
function accept() {
  if (!incoming.value) return;
  if (otherLive.value) {
    pendingSwitch.value = { burnSessionId: otherLive.value.sessionId, run: doAccept };
    return;
  }
  doAccept();
}
function confirmSwitch() {
  const pending = pendingSwitch.value;
  pendingSwitch.value = null;
  if (!pending) return;
  remote.burn(pending.burnSessionId);
  pending.run();
}
function decline() {
  if (incoming.value) remote.decline(incoming.value.sessionId);
}
</script>

<template>
  <!-- live session → a slim banner that jumps into S12 -->
  <button
    v-if="live && !incoming"
    class="mx-6 mt-2 flex w-[calc(100%-3rem)] items-center gap-2 rounded-card border border-line bg-soft px-4 py-2 text-left"
    data-testid="private-live-banner"
    @click="emit('open')"
  >
    <svg viewBox="0 0 24 24" class="size-4 shrink-0 text-accent" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
    <span class="min-w-0 flex-1 truncate text-meta text-ink">
      private session {{ live.status === "verified" ? "· verified" : "· unverified" }}
    </span>
  </button>

  <!-- incoming invite → accept / decline card -->
  <div
    v-else-if="incoming"
    class="mx-6 mt-2 flex items-center gap-3 rounded-card border border-accent/40 bg-soft px-4 py-3"
    data-testid="private-invite-card"
  >
    <svg viewBox="0 0 24 24" class="size-5 shrink-0 text-accent" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
    <div class="min-w-0 flex-1">
      <div class="text-msg text-ink">private session invite</div>
      <div class="text-meta text-muted">
        ephemeral · e2e after fingerprint verify · leaves no trace
      </div>
    </div>
    <button
      class="rounded-pill bg-primary px-4 py-1.5 text-meta text-primary-foreground"
      data-testid="private-accept"
      @click="accept()"
    >
      accept
    </button>
    <button
      class="rounded-pill px-4 py-1.5 text-meta text-muted"
      data-testid="private-decline"
      @click="decline"
    >
      decline
    </button>
  </div>

  <!-- our outgoing invite — waiting state -->
  <div
    v-else-if="outgoing"
    class="mx-6 mt-2 flex items-center gap-2 rounded-card border border-line bg-soft px-4 py-2"
    data-testid="private-outgoing"
  >
    <svg viewBox="0 0 24 24" class="size-4 shrink-0 animate-pulse text-muted" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
    <span class="text-meta text-muted">private invite sent — waiting…</span>
  </div>

  <ConfirmDialog
    v-if="pendingSwitch"
    title="End the current private session?"
    :body="`You have an active private session with ${otherLiveName}. Accepting a new one will end it.`"
    confirm-label="End & accept"
    @confirm="confirmSwitch"
    @cancel="pendingSwitch = null"
  />
</template>
