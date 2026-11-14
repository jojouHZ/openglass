// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { Flame } from "lucide-vue-next";
import { useChatsStore } from "@openglass/core";
import type { ConnState, PrivateInviteView, PrivateSessionView, VerificationView } from "@openglass/core/private/remote";
import { usePrivateRemote } from "../../privateRemote";
import ConfirmDialog from "../ConfirmDialog.vue";
import PrivateSheet from "./PrivateSheet.vue";
import "../../styles/private.css";

const props = defineProps<{ peerId: string; peerName: string; blocked: boolean }>();
const emit = defineEmits<{ verify: [] }>();
const remote = usePrivateRemote();
const session = shallowRef<PrivateSessionView | null>(null);
const incoming = shallowRef<PrivateInviteView | null>(null);
const verification = shallowRef<VerificationView | null>(null);
const relay = ref<ConnState>("offline");
const outgoing = ref(false);
const text = ref("");
const viewOnce = ref(false);
const sheetOpen = ref(false);
const busy = ref(false);
const error = ref("");
const confirmBurn = ref(false);
const chats = useChatsStore();
// rule 5 — one private session per client: starting/accepting while
// another is live asks, then terminates the previous one
const activeSessions = shallowRef<readonly PrivateSessionView[]>([]);
const pendingSwitch = ref<{ burnSessionId: string; run: () => void } | null>(null);
const otherLive = computed(() => activeSessions.value.find((s) => s.peerId !== props.peerId && s.status !== "closed"));
const otherLiveName = computed(() => {
  const other = otherLive.value;
  if (!other) return "";
  const chat = chats.chats.find((c) => c.type === "direct" && c.peer?.id === other.peerId);
  return chat ? chats.chatTitle(chat) : "another chat";
});
function requestOrConfirm(run: () => void) {
  if (otherLive.value) pendingSwitch.value = { burnSessionId: otherLive.value.sessionId, run };
  else run();
}
function confirmSwitch() {
  const pending = pendingSwitch.value;
  pendingSwitch.value = null;
  if (!pending) return;
  remote.burn(pending.burnSessionId);
  pending.run();
}
const off = [
  remote.watchSession(props.peerId, (value) => { session.value = value; }),
  remote.watchVerification(props.peerId, (value) => { verification.value = value; }),
  remote.watchRelayState((value) => { relay.value = value; }),
  remote.watchInvites((value) => {
    incoming.value = value.incoming.find((invite) => invite.peerId === props.peerId) ?? null;
    outgoing.value = value.outgoing.includes(props.peerId);
  }),
  remote.watchActiveSessions((views) => { activeSessions.value = views; }),
];
const trusted = computed(() => verification.value?.state === "verified");
const enabled = computed(() => trusted.value && relay.value === "online" && !props.blocked);
const canSend = computed(() => enabled.value && session.value?.status === "verified" && session.value.canSend);

watch(() => session.value?.messages.map((message) => `${message.id}:${message.read}`).join(","), () => {
  if (session.value?.status === "verified") remote.markDisplayed(session.value.sessionId);
}, { immediate: true });
watch(() => session.value?.sessionId, () => { text.value = ""; error.value = ""; });
onBeforeUnmount(() => {
  off.forEach((stop) => stop());
  if (session.value) remote.purgeRead(session.value.sessionId);
  text.value = "";
});

async function send() {
  const current = session.value;
  const message = text.value.trim();
  if (!current || !message || !canSend.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await remote.send(current.sessionId, message, { viewOnce: viewOnce.value });
    if (text.value.trim() === message) text.value = "";
  } catch {
    error.value = "Private message was not sent. Check the session and retry.";
  } finally {
    busy.value = false;
  }
}

function start(opts: { ttlSeconds: number; strict: boolean }) {
  requestOrConfirm(() => {
    if (enabled.value) remote.startInvite({ id: props.peerId, displayName: props.peerName }, opts);
  });
}
function accept() {
  requestOrConfirm(() => {
    if (enabled.value && incoming.value) remote.accept(incoming.value.sessionId);
  });
}
function burn() {
  if (session.value) remote.burn(session.value.sessionId);
  confirmBurn.value = false;
  text.value = "";
}
</script>

<template>
  <section
    class="shrink-0 border-t border-line"
    aria-label="private layer"
    data-testid="private-layer"
  >
    <div class="flex flex-wrap items-center gap-3 px-4 py-2 text-meta text-muted">
      <span class="flex-1">Private · ephemeral · {{ relay }}</span>
      <button class="min-h-11 px-3 text-ink" data-testid="reverify-device" @click="emit('verify')">Verify device</button>
      <button v-if="session" class="min-h-11 px-3 text-danger" data-testid="burn-btn" @click="confirmBurn = true">Burn session</button>
    </div>
    <p v-if="blocked" class="px-4 py-2 text-meta text-danger">Messaging is off — you are no longer contacts.</p>
    <p v-if="!trusted" class="px-4 py-2 text-meta text-danger">Verify this device before starting or accepting a private session.</p>
    <div v-if="incoming" class="px-4 py-3" data-testid="invite-incoming">
      <p class="text-msg text-ink">{{ peerName }} invites you to a private session.</p>
      <button class="min-h-11 px-4 text-primary" :disabled="!enabled" data-testid="invite-accept" @click="accept">Accept</button>
      <button class="min-h-11 px-4 text-muted" data-testid="invite-decline" @click="remote.decline(incoming.sessionId)">Decline</button>
    </div>
    <div v-else-if="outgoing" class="px-4 py-3" data-testid="invite-waiting">
      <p class="text-msg text-ink">Waiting for {{ peerName }}…</p>
      <p class="text-meta text-muted" data-testid="timeline-invite">invite sent · the server sees only opaque envelopes</p>
      <button class="min-h-11 px-4 text-muted" @click="remote.cancelInvite(peerId)">Cancel invite</button>
    </div>
    <div v-else-if="!session" class="px-4 py-3">
      <button class="min-h-11 rounded-pill bg-primary px-4 text-meta text-primary-foreground disabled:opacity-40" :disabled="!enabled" data-testid="start-private" @click="sheetOpen = true">Invite to private session</button>
      <PrivateSheet v-model:open="sheetOpen" @start="start" />
    </div>
    <p v-if="session?.status === 'exchanging'" class="px-4 py-3 text-meta text-muted" role="status">Checking signed session keys…</p>
    <p v-if="session?.peerOfflineUntil" class="px-4 py-2 text-meta text-muted">Peer offline — session may expire.</p>
    <p v-if="error" class="px-4 text-meta text-danger" role="alert">{{ error }}</p>
    <form class="flex items-end gap-2 border-t border-line px-4 py-3" @submit.prevent="send">
      <!-- F-4: compact vertical switch — flame in the thumb, lock in the
           same slot while the contact is unverified -->
      <button
        v-if="trusted"
        type="button"
        role="switch"
        :aria-checked="viewOnce"
        aria-label="view once"
        class="flex h-11 w-7 shrink-0 flex-col items-center justify-between rounded-full border py-1.5 transition-colors"
        :class="viewOnce ? 'border-primary bg-primary' : 'border-line bg-soft'"
        data-testid="view-once-toggle"
        @click="viewOnce = !viewOnce"
      >
        <span
          class="grid size-5 place-items-center rounded-full transition-colors"
          :class="viewOnce ? 'bg-primary-foreground text-primary' : 'bg-card text-muted'"
        >
          <Flame class="size-3" :stroke-width="2" />
        </span>
      </button>
      <span v-else class="grid h-11 w-7 shrink-0 place-items-center text-muted" title="verify device first" data-testid="view-once-lock">
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </span>
      <textarea v-model="text" class="min-h-11 min-w-0 flex-1 rounded-control border border-line bg-bg px-3 py-2 text-[16px] text-ink" :disabled="!canSend || busy" aria-label="private message" placeholder="Private message" data-testid="priv-input" />
      <button class="min-h-11 rounded-pill bg-primary px-4 text-meta text-primary-foreground disabled:opacity-40" :disabled="!canSend || busy || !text.trim()" data-testid="priv-send">Send</button>
    </form>
    <div v-if="confirmBurn" role="alertdialog" aria-label="burn private session" class="border-t border-line bg-bg p-4">
      <p class="text-meta text-ink">Delete this private session and its messages for both people?</p>
      <button class="min-h-11 px-4 text-danger" data-testid="confirm-action" @click="burn">Burn</button>
      <button class="min-h-11 px-4 text-muted" @click="confirmBurn = false">Cancel</button>
    </div>
    <ConfirmDialog
      v-if="pendingSwitch"
      title="End the current private session?"
      :body="`You have an active private session with ${otherLiveName}. Starting a new one will end it.`"
      confirm-label="End & start"
      @confirm="confirmSwitch"
      @cancel="pendingSwitch = null"
    />
  </section>
</template>
