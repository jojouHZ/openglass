// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

<!-- Private invite card — rendered inside S5 for a DM peer.
     pwa-dev only (the route graph and this import sit behind
     VITE_PRIVATE_MODULE; the mvp bundle never sees this file). -->

<script setup lang="ts">
import { computed } from "vue";

import { usePrivateStore } from "@openglass/core/private/store";

const props = defineProps<{ peerId: string; chatId: string }>();
const emit = defineEmits<{ verify: [sessionId: string] }>();
const priv = usePrivateStore();

/** incoming invite from this peer, or our outgoing pending invite */
const incoming = computed(() =>
  priv.incomingInvites.find((s) => s.peer.id === props.peerId) ?? null,
);
const outgoing = computed(() => priv.outgoingInvites.includes(props.peerId));
/** a live session with this peer (any non-closed status) */
const live = computed(() => priv.sessionByPeer(props.peerId));

function accept() {
  if (!incoming.value) return;
  priv.accept(incoming.value.id);
}
function decline() {
  if (incoming.value) priv.decline(incoming.value.id);
}
</script>

<template>
  <!-- live session → a slim banner that jumps into S12 -->
  <button
    v-if="live && !incoming"
    class="mx-6 mt-2 flex w-[calc(100%-3rem)] items-center gap-2 rounded-card border border-line bg-soft px-4 py-2 text-left"
    data-testid="private-live-banner"
    @click="$router.push({ name: 's12-private-chat', params: { chatId } })"
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
      class="rounded-pill bg-ink px-4 py-1.5 text-meta text-bg"
      data-testid="private-accept"
      @click="accept(); emit('verify', incoming!.id)"
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
</template>
