// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import type { LocalMessage } from "@openglass/core";
import {
  ApiRequestError,
  api,
  dayChanged,
  toSeries,
  useChatsStore,
  useSessionStore,
} from "@openglass/core";

import type { StagedAttachment } from "../components/chat/attachment";
import { MAX_ATTACHMENT } from "../components/chat/attachment";
import AttachmentView from "../components/chat/AttachmentView.vue";
import Composer from "../components/chat/Composer.vue";
import ChatSearch from "../components/chat/ChatSearch.vue";
import MessageMenu from "../components/chat/MessageMenu.vue";

const route = useRoute();
const router = useRouter();
const chats = useChatsStore();
const session = useSessionStore();

// Private layer (pwa-dev only): the env flag is statically replaced, so
// in the mvp build this entire branch — imports included — is dead code
// and the private chunk never enters the bundle graph.
const privateEnabled = import.meta.env.VITE_PRIVATE_MODULE === "1";
const PrivateInviteCard = privateEnabled
  ? defineAsyncComponent(
      () => import("../components/private/PrivateInviteCard.vue"),
    )
  : null;
const privStore = shallowRef<{ sessionByPeer: (id: string) => { id: string } | null } | null>(null);
if (privateEnabled) {
  void import("@openglass/core/private/store").then((m) => {
    privStore.value = m.usePrivateStore();
  });
}

const chatId = computed(() => String(route.params.chatId));
const chat = computed(() => chats.chats.find((c) => c.id === chatId.value));
const title = computed(() => (chat.value ? chats.chatTitle(chat.value) : "chat"));
const win = computed(() => chats.window(chatId.value));
const series = computed(() => toSeries(win.value.messages));
const dayLabels = computed(() => {
  const out: string[] = [];
  series.value.forEach((s, i) => {
    const prevSeries = series.value[i - 1];
    const prev = prevSeries?.at(-1);
    out.push(dayChanged(prev, s[0]!) ? fmtDay(s[0]!.sentAt) : "");
  });
  return out;
});
const peer = computed(() => (chat.value?.type === "direct" ? chat.value.peer : null));
const typing = computed(() => chats.typingIn(chatId.value));
const offline = computed(() => chats.connState !== "online");
const peerReadSeq = computed(() => chats.peerReadSeq[chatId.value] ?? 0);

const subtitle = computed(() => {
  if (typing.value) return "typing…";
  if (chat.value?.type === "group") {
    const n = chats.details[chatId.value]?.members?.length;
    // detail still loading / fetch failed — show nothing over a false 0
    return n != null ? `${n} members` : "";
  }
  if (peer.value?.id === session.user?.id) return "saved messages";
  return chats.isOnline(peer.value?.id) ? "online" : "last seen recently";
});

const scrollEl = ref<HTMLElement>();
const initialScrollDone = ref(false);
const highlightId = ref<string | null>(null);

// --- scroll: anchor bottom on first load, preserve on prepend ---
let restoring = false;
function onScroll() {
  const el = scrollEl.value;
  if (!el || restoring) return;
  if (el.scrollTop < 40 && win.value.nextCursor && !win.value.loading) {
    void loadOlder();
  }
}

async function loadOlder() {
  const el = scrollEl.value;
  const prevH = el?.scrollHeight ?? 0;
  const prevT = el?.scrollTop ?? 0;
  await chats.loadOlder(chatId.value);
  await nextTick();
  if (el) {
    restoring = true;
    el.scrollTop = el.scrollHeight - prevH + prevT;
    requestAnimationFrame(() => (restoring = false));
  }
}

/** Manual retry — the failed direction lives on the window's loadError. */
function retryLoad() {
  const dir = win.value.loadError;
  if (dir === "newer") return chats.loadNewer(chatId.value);
  if (dir === "older") return loadOlder();
  return chats.loadTail(chatId.value);
}

async function scrollToBottom() {
  await nextTick();
  if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
}

// --- composer ---
const replyTo = ref<LocalMessage | null>(null);
const editing = ref<LocalMessage | null>(null);
const staged = ref<StagedAttachment | null>(null);
/** send / pin / delete / search failures all land on this strip */
const actionError = ref("");

/** Every chat action surfaces its failure — nothing fails silently. */
async function chatAction(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    actionError.value = `${label} failed — try again`;
  }
}

async function stageFile(f: File) {
  if (f.size > MAX_ATTACHMENT) {
    staged.value = {
      fileName: f.name,
      sizeBytes: f.size,
      error: "exceeds 25 mb limit",
    };
    return;
  }
  staged.value = { fileName: f.name, sizeBytes: f.size };
  try {
    const { attachment } = await api().messages.uploadAttachment(chatId.value, f);
    if (!staged.value) return; // strip cancelled mid-upload
    staged.value = { ...staged.value, attachmentId: attachment.id };
  } catch (e) {
    if (!staged.value) return;
    staged.value = {
      ...staged.value,
      error: "upload failed",
    };
  }
}

async function onSend(text: string) {
  actionError.value = "";
  try {
    if (editing.value) {
      await chats.edit(editing.value.id, text);
      editing.value = null;
      return;
    }
    await chats.send(chatId.value, {
      text: text || undefined,
      attachmentIds: staged.value?.attachmentId ? [staged.value.attachmentId] : undefined,
      replyToMessageId: replyTo.value?.id,
    });
    replyTo.value = null;
    staged.value = null;
    await scrollToBottom();
  } catch {
    actionError.value = "send failed — message marked";
  }
}

function cancelStrip() {
  replyTo.value = null;
  editing.value = null;
  staged.value = null;
}

// --- message menu ---
const menu = ref<{ m: LocalMessage; x: number; y: number } | null>(null);

// party/raid rights — UI gate only, the server enforces
const myMember = computed(() => chats.myMember(chatId.value));
const canPinMsg = computed(
  () =>
    chat.value?.type !== "group" ||
    myMember.value?.role === "owner" ||
    !!myMember.value?.rights?.pinMessages,
);
function canDeleteMsg(m: LocalMessage) {
  if (m.senderId === session.user?.id) return true;
  return myMember.value?.role === "owner" || !!myMember.value?.rights?.deleteMessages;
}
let lpTimer: ReturnType<typeof setTimeout> | null = null;

function openMenu(m: LocalMessage, e: MouseEvent) {
  menu.value = { m, x: e.clientX, y: e.clientY };
}
function longPressStart(m: LocalMessage, e: PointerEvent) {
  lpTimer = setTimeout(() => (menu.value = { m, x: e.clientX, y: e.clientY }), 500);
}
function longPressEnd() {
  if (lpTimer) clearTimeout(lpTimer);
  lpTimer = null;
}

function copyText(m: LocalMessage) {
  if (!m.text) return;
  navigator.clipboard
    ?.writeText(m.text)
    .catch(() => (actionError.value = "copy failed"));
}

// --- header menu / search / pinned ---
const headMenu = ref(false);
const searchOpen = ref(false);
const searchResults = ref<LocalMessage[]>([]);
const searchIdx = ref(0);
const pinned = ref<LocalMessage[]>([]);
const pinnedBarHidden = ref(false);
const pinnedShown = computed(() => (!pinnedBarHidden.value ? pinned.value.at(-1) : undefined));

async function onSearchQuery(q: string) {
  if (!q) {
    searchResults.value = [];
    return;
  }
  try {
    searchResults.value = await chats.search(chatId.value, q);
  } catch {
    searchResults.value = [];
    actionError.value = "search failed — try again";
    return;
  }
  searchIdx.value = 0;
  await focusResult();
}

async function focusResult() {
  const m = searchResults.value[searchIdx.value];
  if (!m) return;
  await chats.jumpTo(chatId.value, m.id);
  highlightId.value = m.id;
  await nextTick();
  scrollEl.value
    ?.querySelector(`[data-mid="${m.id}"]`)
    ?.scrollIntoView({ block: "center" });
}

const stepSearch = async (d: number) => {
  const n = searchResults.value.length;
  if (!n) return;
  searchIdx.value = (searchIdx.value + d + n) % n;
  await focusResult();
};

async function openPinned() {
  if (!pinnedShown.value) return;
  await chats.jumpTo(chatId.value, pinnedShown.value.id);
  highlightId.value = pinnedShown.value.id;
}

function onPrivateToggle() {
  const p = peer.value;
  if (!p) return;
  router.push(
    privStore.value?.sessionByPeer(p.id)
      ? { name: "s12-private-chat", params: { chatId: chatId.value } }
      : { name: "s11-session-setup", params: { chatId: chatId.value } },
  );
}

async function toggleChatPin() {
  headMenu.value = false;
  try {
    if (chat.value) await api().chats.setPinned(chatId.value, !chat.value.pinned);
    await chats.refreshChats();
  } catch {
    actionError.value = "pin failed — try again";
  }
}

function senderName(m: LocalMessage) {
  if (chat.value?.type !== "group" || m.senderId === session.user?.id) return "";
  return (
    chats.details[chatId.value]?.members?.find(
      (x) => x.user.id === m.senderId,
    )?.user.displayName ?? ""
  );
}

function tickClass(m: LocalMessage) {
  if (m.senderId !== session.user?.id) return "";
  if (m.failed) return "text-danger";
  if (m.pending) return "text-muted";
  return m.seq <= peerReadSeq.value ? "text-accent" : "text-muted";
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

const notFound = ref(false);

async function enterChat() {
  notFound.value = false;
  await chats.refreshChats();
  await chats.connectRealtime().catch(() => undefined);
  try {
    await chats.openChat(chatId.value);
  } catch (e) {
    // 404 = deleted chat / membership revoked — a product state, not a typo
    if (e instanceof ApiRequestError && e.status === 404) {
      notFound.value = true;
      return;
    }
    console.warn("[s5] openChat failed", e);
  }
  pinned.value = await chats.pinnedMessages(chatId.value).catch(() => []);
  await scrollToBottom();
  initialScrollDone.value = true;
}

onMounted(enterChat);

// same component instance is reused when chatId changes — reset + reload
watch(chatId, async () => {
  cancelStrip();
  headMenu.value = false;
  searchOpen.value = false;
  searchResults.value = [];
  highlightId.value = null;
  pinnedBarHidden.value = false;
  await enterChat();
});

onBeforeUnmount(() => chats.closeChat());

// own appended message → keep bottom pinned
watch(
  () => win.value.messages.length,
  async (n, o) => {
    if (!initialScrollDone.value || n <= (o ?? 0)) return;
    const last = win.value.messages.at(-1);
    const el = scrollEl.value;
    const nearBottom = el && el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (last?.senderId === session.user?.id || nearBottom) await scrollToBottom();
  },
);

// mark incoming read while chat is open
watch(
  () => win.value.messages.at(-1)?.seq,
  (seq, old) => {
    if (seq && seq !== old) void chats.markRead(chatId.value);
  },
);
</script>

<template>
  <!-- valid path, gone entity: deleted chat / revoked membership -->
  <main v-if="notFound" class="grid h-dvh place-items-center px-6" data-testid="not-found">
    <div class="flex flex-col items-center gap-3 text-center">
      <div class="text-body text-ink">chat not found</div>
      <div class="text-meta text-muted">it was deleted or you're no longer a member</div>
      <button
        class="mt-1 h-11 rounded-pill bg-ink px-6 text-msg text-bg"
        @click="router.push({ name: 's4-chat-list' })"
      >
        back to chats
      </button>
    </div>
  </main>

  <!-- h-dvh + overflow-hidden: the header and composer stay pinned;
       only the messages layer scrolls (flex child needs min-h-0) -->
  <main v-else class="relative flex h-dvh flex-col overflow-hidden">
    <!-- header -->
    <div class="flex items-center gap-3 border-b border-line px-6 pb-3 pt-8">
      <button class="text-ink" aria-label="back" @click="router.push({ name: 's4-chat-list' })">
        <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m12 19-7-7 7-7" />
          <path d="M19 12H5" />
        </svg>
      </button>
      <div class="min-w-0 flex-1">
        <div class="truncate text-name text-ink">{{ title }}</div>
        <div class="text-sub" :class="typing ? 'text-accent' : 'text-muted'">
          {{ subtitle }}
        </div>
      </div>
      <button
        v-if="chat?.type === 'direct' && peer && peer.id !== session.user?.id"
        class="grid size-10 place-items-center rounded-full bg-bubble-in text-name text-muted"
        data-testid="peer-avatar"
        @click="router.push({ name: 's7-contact-profile', params: { userId: peer.id } })"
      >
        {{ title.slice(0, 1) }}
      </button>
      <button
        v-else-if="chat?.type === 'group'"
        class="grid size-10 place-items-center rounded-full bg-bubble-in text-name text-muted"
        aria-label="group settings"
        data-testid="group-avatar"
        @click="router.push({ name: 's9a-group-manage', params: { chatId } })"
      >
        {{ title.slice(0, 1) }}
      </button>
      <span v-else class="grid size-10 place-items-center rounded-full bg-bubble-in text-name text-muted">
        {{ title.slice(0, 1) }}
      </span>
      <button
        v-if="privateEnabled && peer && peer.id !== session.user?.id"
        class="p-1"
        :class="privStore?.sessionByPeer(peer.id) ? 'text-accent' : 'text-muted'"
        aria-label="private session"
        data-testid="private-toggle"
        @click="onPrivateToggle"
      >
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </button>
      <button class="p-1 text-muted" aria-label="chat menu" @click="headMenu = !headMenu">
        <svg viewBox="0 0 24 24" class="size-4" fill="currentColor">
          <circle cx="5" cy="12" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
        </svg>
      </button>
    </div>

    <!-- header dropdown -->
    <div v-if="headMenu" class="absolute right-6 top-20 z-40 w-40 rounded-card border border-line bg-bg py-2 shadow-lg">
      <button
        class="block w-full px-4 py-2 text-left text-msg text-body hover:bg-canvas"
        @click="(headMenu = false), (searchOpen = true)"
      >
        search
      </button>
      <button
        class="block w-full px-4 py-2 text-left text-msg text-body hover:bg-canvas"
        @click="toggleChatPin"
      >
        {{ chat?.pinned ? "unpin chat" : "pin chat" }}
      </button>
    </div>
    <div v-if="headMenu" class="fixed inset-0 z-30" @click="headMenu = false" />

    <!-- private invite / live-session card (pwa-dev only) -->
    <component
      :is="PrivateInviteCard"
      v-if="PrivateInviteCard && peer && peer.id !== session.user?.id"
      :peer-id="peer.id"
      :chat-id="chatId"
      @verify="router.push({ name: 's11b-verify', params: { chatId } })"
    />

    <ChatSearch
      v-if="searchOpen"
      :total="searchResults.length"
      :current="searchIdx"
      @query="onSearchQuery"
      @prev="stepSearch(-1)"
      @next="stepSearch(1)"
      @close="(searchOpen = false), (searchResults = []), (highlightId = null)"
    />

    <!-- offline banner (static state — no outbox) -->
    <div
      v-if="offline"
      class="flex items-center gap-2 bg-soft px-6 py-2 text-meta text-body"
      data-testid="offline-banner"
    >
      <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 20h.01M8.5 16.429a5 5 0 0 1 7 0M5 12.859a10 10 0 0 1 5.17-2.69M19 12.859a10 10 0 0 0-2.007-1.523M2 8.82a15 15 0 0 1 4.177-2.643M22 8.82a15 15 0 0 0-11.288-3.764m0 0L2 2l20 20" />
      </svg>
      offline — composer disabled
    </div>

    <!-- pinned bar -->
    <button
      v-if="pinnedShown"
      class="flex w-full items-center gap-3 border-b border-line px-6 py-2 text-left"
      data-testid="pinned-bar"
      @click="openPinned"
    >
      <svg viewBox="0 0 24 24" class="size-4 shrink-0 text-accent" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" />
      </svg>
      <span class="min-w-0 flex-1 truncate text-msg text-body">
        <span class="text-accent">{{ senderName(pinnedShown) || title }}</span><br />
        {{ pinnedShown.text }}
      </span>
      <span class="p-1 text-muted" @click.stop="pinnedBarHidden = true">✕</span>
    </button>

    <!-- messages -->
    <div ref="scrollEl" class="min-h-0 flex-1 overflow-y-auto px-6 py-4" data-testid="msg-scroll" @scroll="onScroll">
      <div v-if="win.loading && !win.messages.length" class="py-8 text-center text-meta text-muted">
        loading…
      </div>
      <div
        v-else-if="win.loadError && !win.messages.length"
        class="py-8 text-center"
        data-testid="history-error"
      >
        <div class="text-meta text-danger">couldn't load messages</div>
        <button
          class="mt-1 text-meta text-accent"
          data-testid="history-retry"
          @click="chats.loadTail(chatId)"
        >
          retry
        </button>
      </div>
      <div v-if="win.loadError && win.messages.length" class="pb-2 text-center">
        <button
          class="text-meta text-danger"
          data-testid="history-retry"
          @click="retryLoad"
        >
          couldn't load — retry
        </button>
      </div>
      <div v-else-if="win.nextCursor" class="pb-2 text-center">
        <button class="text-meta text-accent" data-testid="load-older" @click="loadOlder">
          load earlier
        </button>
      </div>
      <div v-if="!win.atTail && win.newerCursor" class="sticky bottom-2 pb-2 text-center">
        <button
          class="rounded-pill bg-ink px-4 py-1 text-meta text-bg"
          data-testid="load-newer"
          @click="chats.loadNewer(chatId)"
        >
          jump to latest
        </button>
      </div>

      <template v-for="(s, si) in series" :key="s[0]!.id">
        <div v-if="dayLabels[si]" class="py-3 text-center text-sub text-muted">
          {{ dayLabels[si] }}
        </div>
        <div class="mb-4 flex flex-col gap-1" :class="s[0]!.senderId === session.user?.id ? 'items-end' : 'items-start'">
          <div
            v-for="(m, mi) in s"
            :key="m.id"
            :data-mid="m.id"
            class="flex max-w-[80%] items-end gap-2"
            @contextmenu.prevent="openMenu(m, $event)"
            @pointerdown="longPressStart(m, $event)"
            @pointerup="longPressEnd"
            @pointerleave="longPressEnd"
          >
            <span
              v-if="s[0]!.senderId !== session.user?.id"
              class="size-7 shrink-0 rounded-full bg-bubble-in"
              :class="mi === s.length - 1 ? 'opacity-100' : 'opacity-0'"
            />
            <div
              class="rounded-card px-3 py-2 text-msg"
              :class="[
                m.senderId === session.user?.id
                  ? 'bg-bubble-own text-bg'
                  : 'bg-bubble-in text-ink',
                m.failed ? 'outline outline-1 outline-danger' : '',
                highlightId === m.id ? 'ring-2 ring-accent' : '',
                m.pending ? 'opacity-70' : '',
              ]"
            >
              <div v-if="mi === 0 && senderName(m)" class="text-sender text-accent">
                {{ senderName(m) }}
              </div>
              <div v-if="m.replyToMessageId" class="mb-1 border-l-2 border-accent pl-2 text-sub opacity-80">
                reply
              </div>
              <div v-if="m.text" class="whitespace-pre-wrap break-words">{{ m.text }}</div>
              <div v-if="m.attachments?.length" class="mt-1 flex flex-col gap-1">
                <AttachmentView v-for="a in m.attachments" :key="a.id" :att="a" />
              </div>
              <div class="mt-0.5 flex items-center justify-end gap-1 text-meta opacity-70">
                <span v-if="m.editedAt" class="text-micro">edited</span>
                <span>{{ fmtTime(m.sentAt) }}</span>
                <span v-if="m.senderId === session.user?.id" :class="tickClass(m)" data-testid="msg-state">
                  <svg v-if="m.failed" viewBox="0 0 24 24" class="size-3.5" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
                  </svg>
                  <svg v-else-if="m.pending" viewBox="0 0 24 24" class="size-3.5 animate-spin" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2v4M18 12h4M12 18v4M2 12h4" />
                  </svg>
                  <svg v-else-if="m.seq <= peerReadSeq" viewBox="0 0 24 24" class="size-3.5" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6 7 17l-5-5" /><path d="m22 10-7.5 7.5L13 16" />
                  </svg>
                  <svg v-else viewBox="0 0 24 24" class="size-3.5" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
              </div>
            </div>
          </div>
        </div>
      </template>
      <div
        v-if="!win.loading && !win.messages.length && !win.loadError"
        class="py-8 text-center text-meta text-muted"
      >
        no messages yet
      </div>
    </div>

    <div v-if="actionError" class="px-6 pb-1 text-meta text-danger" data-testid="action-error">
      {{ actionError }}
    </div>
    <Composer
      :offline="offline"
      :reply-to="replyTo"
      :editing="editing"
      :staged="staged"
      :reply-target-name="replyTo ? senderName(replyTo) || title : ''"
      @send="onSend"
      @cancel="cancelStrip"
      @stage="stageFile"
    />

    <MessageMenu
      v-if="menu"
      :message="menu.m"
      :own="menu.m.senderId === session.user?.id"
      :can-pin="canPinMsg"
      :can-delete="canDeleteMsg(menu.m)"
      :x="menu.x"
      :y="menu.y"
      @reply="replyTo = menu!.m"
      @copy="copyText(menu!.m)"
      @edit="editing = menu!.m"
      @pin="chatAction('pin', () => chats.setMessagePinned(menu!.m.id, !menu!.m.pinned))"
      @delete="chatAction('delete', () => chats.remove(menu!.m.id))"
      @close="menu = null"
    />
  </main>
</template>
