// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Chats store — chat list, per-chat message windows, realtime wiring.
// REST for state, WS for deltas (contract: send = REST+clientNonce,
// delivery = WS message.new). No outbox — failed sends are surfaced
// on the bubble, not queued.

import { defineStore } from "pinia";

import type { ApiClient } from "../api/client";
import type { Chat, ChatSummary, Message } from "../api/client";
import type { Unsubscribe } from "../api/client";
import { api, useSessionStore } from "./session";

export interface LocalMessage extends Message {
  /** client-only: optimistic send in flight / failed */
  pending?: boolean;
  failed?: boolean;
}

interface ChatWindow {
  messages: LocalMessage[]; // ascending seq
  nextCursor: string | null; // older page
  newerCursor: string | null; // newer page (after an `around` jump)
  loading: boolean;
  /** true once the newest tail is loaded (steady state) */
  atTail: boolean;
}

const emptyWindow = (): ChatWindow => ({
  messages: [],
  nextCursor: null,
  newerCursor: null,
  loading: false,
  atTail: false,
});

/** Consecutive messages by one sender within this gap share a series. */
export const SERIES_GAP_MS = 5 * 60_000;

export const useChatsStore = defineStore("chats", {
  state: () => ({
    chats: [] as ChatSummary[],
    /** full Chat objects (members for groups) — fetched on open */
    details: {} as Record<string, Chat>,
    windows: {} as Record<string, ChatWindow>,
    /** chatId → userIds typing right now */
    typing: {} as Record<string, Record<string, string>>,
    online: {} as Record<string, boolean>,
    /** chatId → peer's read cursor (✓✓ boundary on own messages) */
    peerReadSeq: {} as Record<string, number>,
    connState: "offline" as "connecting" | "online" | "offline",
    wsConnected: false,
    unsubs: [] as Unsubscribe[],
    /** Chat the user is looking at — suppresses its unread bumps. */
    activeChatId: null as string | null,
  }),

  getters: {
    window:
      (s) =>
      (chatId: string): ChatWindow =>
        s.windows[chatId] ?? emptyWindow(),
    typingIn: (s) => (chatId: string) => {
      const t = s.typing[chatId];
      if (!t) return null;
      const now = Date.now();
      return Object.keys(t).find((u) => new Date(t[u]!).getTime() > now) ?? null;
    },
    isOnline: (s) => (userId?: string) => !!userId && !!s.online[userId],
  },

  actions: {
    isSaved(c: ChatSummary): boolean {
      const s = useSessionStore();
      return c.type === "direct" && c.peer?.id === s.user?.id;
    },

    async refreshChats() {
      const { chats } = await api().chats.list();
      this.chats = sortChats(chats);
    },

    chatTitle(c: ChatSummary): string {
      const s = useSessionStore();
      if (c.type === "direct" && c.peer?.id === s.user?.id) return "saved messages";
      return c.title ?? c.peer?.displayName ?? "chat";
    },

    /** Ensure the chat window has its newest page loaded. */
    async openChat(chatId: string) {
      this.activeChatId = chatId;
      const w = this.ensureWindow(chatId);
      if (!w.atTail && !w.loading) await this.loadTail(chatId);
      this.details[chatId] ??= (await api().chats.get(chatId)).chat;
      await this.markRead(chatId);
    },

    closeChat() {
      this.activeChatId = null;
    },

    async loadTail(chatId: string) {
      const w = this.ensureWindow(chatId);
      w.loading = true;
      try {
        const page = await api().messages.list(chatId, { limit: 50 });
        w.messages = page.messages;
        w.nextCursor = page.nextCursor;
        w.newerCursor = page.newerCursor;
        w.atTail = !page.newerCursor;
      } finally {
        w.loading = false;
      }
    },

    async loadOlder(chatId: string) {
      const w = this.windows[chatId];
      if (!w?.nextCursor || w.loading) return;
      w.loading = true;
      try {
        const page = await api().messages.list(chatId, {
          limit: 50,
          before: w.nextCursor,
        });
        w.messages = [...page.messages, ...w.messages];
        w.nextCursor = page.nextCursor;
      } finally {
        w.loading = false;
      }
    },

    async loadNewer(chatId: string) {
      const w = this.windows[chatId];
      if (!w?.newerCursor || w.loading) return;
      w.loading = true;
      try {
        const page = await api().messages.list(chatId, {
          limit: 50,
          after: w.newerCursor,
        });
        w.messages = [...w.messages, ...page.messages];
        w.newerCursor = page.newerCursor;
        w.atTail = !page.newerCursor;
      } finally {
        w.loading = false;
      }
    },

    /** Jump to a message by id (search hit / pinned / reply target). */
    async jumpTo(chatId: string, messageId: string) {
      const w = this.ensureWindow(chatId);
      w.loading = true;
      try {
        const page = await api().messages.list(chatId, { around: messageId, limit: 30 });
        w.messages = page.messages;
        w.nextCursor = page.nextCursor;
        w.newerCursor = page.newerCursor;
        w.atTail = !page.newerCursor;
      } finally {
        w.loading = false;
      }
    },

    async send(
      chatId: string,
      body: { text?: string; attachmentIds?: string[]; replyToMessageId?: string },
    ) {
      const session = useSessionStore();
      const me = session.user;
      const nonce = crypto.randomUUID();
      const w = this.ensureWindow(chatId);
      const optimistic: LocalMessage = {
        id: `local-${nonce}`,
        chatId,
        seq: (w.messages.at(-1)?.seq ?? 0) + 1,
        senderId: me?.id ?? "",
        text: body.text ?? null,
        clientNonce: nonce,
        sentAt: new Date().toISOString(),
        replyToMessageId: body.replyToMessageId ?? null,
        pinned: false,
        pending: true,
      };
      w.messages.push(optimistic);
      try {
        const { message } = await api().messages.send(chatId, { clientNonce: nonce, ...body });
        const i = w.messages.findIndex((m) => m.clientNonce === nonce);
        if (i !== -1) w.messages[i] = message;
        else w.messages.push(message);
        this.bumpSummary(chatId, message);
      } catch (e) {
        const m = w.messages.find((x) => x.clientNonce === nonce);
        if (m) {
          m.pending = false;
          m.failed = true; // surfaced on the bubble — no retry queue (FDD)
        }
        throw e;
      }
    },

    async edit(messageId: string, text: string) {
      const { message } = await api().messages.edit(messageId, text);
      this.replaceMessage(message);
    },

    async remove(messageId: string) {
      await api().messages.delete(messageId);
      for (const w of Object.values(this.windows)) {
        w.messages = w.messages.filter((m) => m.id !== messageId);
      }
    },

    async setMessagePinned(messageId: string, pinned: boolean) {
      const { message } = await api().messages.setPinned(messageId, pinned);
      this.replaceMessage(message);
    },

    async search(chatId: string, q: string) {
      return (await api().messages.list(chatId, { q, limit: 100 })).messages;
    },

    async pinnedMessages(chatId: string) {
      return (await api().messages.list(chatId, { pinned: true, limit: 100 })).messages;
    },

    async markRead(chatId: string) {
      const w = this.windows[chatId];
      const upTo = w?.messages.at(-1)?.seq;
      if (upTo) {
        const s = this.chatSummaries0(chatId);
        if (s) s.unreadCount = 0;
        await api().messages.markRead(chatId, upTo).catch(() => undefined);
      }
    },

    // ---------- realtime ----------

    /** Open the WS channel + subscriptions. Call after auth / on hydrate. */
    async connectRealtime() {
      if (this.wsConnected) return;
      const session = useSessionStore();
      if (!session.accessToken) return;
      this.wsConnected = true;
      const ev = api().events;
      this.unsubs.push(
        ev.onStateChange((s) => (this.connState = s)),
        ev.on("presence.snapshot", (e) => {
          for (const id of e.data.onlineUserIds) this.online[id] = true;
        }),
        ev.on("presence", (e) => {
          this.online[e.data.userId] = e.data.status === "online";
        }),
        ev.on("typing", (e) => {
          const t = (this.typing[e.data.chatId] ??= {});
          t[e.data.userId] = e.data.until;
        }),
        ev.on("message.new", (e) => this.onMessageNew(e.data)),
        ev.on("message.edited", (e) => this.replaceMessage(e.data)),
        ev.on("message.pinned", (e) => this.setPinnedFlag(e.data.messageId, true)),
        ev.on("message.unpinned", (e) => this.setPinnedFlag(e.data.messageId, false)),
        ev.on("message.deleted", (e) => {
          const w = this.windows[e.data.chatId];
          if (w) w.messages = w.messages.filter((m) => m.id !== e.data.messageId);
        }),
        ev.on("receipt.read", (e) => {
          if (e.data.userId !== session.user?.id) {
            this.peerReadSeq[e.data.chatId] = Math.max(
              this.peerReadSeq[e.data.chatId] ?? 0,
              e.data.upToSeq,
            );
          }
        }),
        ev.on("chat.new", (e) => {
          this.details[e.data.chat.id] = e.data.chat;
          void this.refreshChats();
        }),
        ev.on("chat.updated", (e) => {
          this.details[e.data.chat.id] = e.data.chat;
          void this.refreshChats();
        }),
      );
      await ev.connect(session.accessToken);
    },

    disconnectRealtime() {
      for (const u of this.unsubs) u();
      this.unsubs = [];
      api().events.disconnect();
      this.wsConnected = false;
    },

    onMessageNew(message: Message) {
      const w = this.windows[message.chatId];
      if (w && !w.messages.some((m) => m.id === message.id)) {
        if (w.atTail) w.messages.push(message);
        else w.newerCursor = null; // window mode — refetch tail policy stays simple
      }
      this.bumpSummary(message.chatId, message);
    },

    bumpSummary(chatId: string, message: Message) {
      const s = this.chatSummaries0(chatId);
      if (s) {
        s.lastMessage = message;
        s.lastActivityAt = message.sentAt;
        const session = useSessionStore();
        if (message.senderId !== session.user?.id && chatId !== this.activeChatId) {
          s.unreadCount += 1;
        }
      }
      this.chats = sortChats(this.chats);
    },

    setPinnedFlag(messageId: string, pinned: boolean) {
      for (const w of Object.values(this.windows)) {
        const m = w.messages.find((x) => x.id === messageId);
        if (m) m.pinned = pinned;
      }
    },

    replaceMessage(m: Message) {
      const w = this.windows[m.chatId];
      if (!w) return;
      const i = w.messages.findIndex((x) => x.id === m.id);
      if (i !== -1) w.messages[i] = m;
      const s = this.chatSummaries0(m.chatId);
      if (s?.lastMessage?.id === m.id) s.lastMessage = m;
    },

    ensureWindow(chatId: string): ChatWindow {
      return (this.windows[chatId] ??= emptyWindow());
    },

    chatSummaries0(chatId: string): ChatSummary | undefined {
      return this.chats.find((c) => c.id === chatId);
    },
  },
});

/** Contract ordering: pinned first, then lastActivityAt desc. */
export function sortChats(chats: ChatSummary[]): ChatSummary[] {
  return [...chats].sort(
    (a, b) =>
      Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
      b.lastActivityAt.localeCompare(a.lastActivityAt),
  );
}

/** Group consecutive same-sender messages into visual series. */
export function toSeries(messages: LocalMessage[]): LocalMessage[][] {
  const out: LocalMessage[][] = [];
  for (const m of messages) {
    const prev = out.at(-1);
    const last = prev?.at(-1);
    if (
      prev &&
      last &&
      last.senderId === m.senderId &&
      new Date(m.sentAt).getTime() - new Date(last.sentAt).getTime() < SERIES_GAP_MS
    ) {
      prev.push(m);
    } else {
      out.push([m]);
    }
  }
  return out;
}

/** Day-separator label between two messages, or null. */
export function dayChanged(prev: Message | undefined, cur: Message): boolean {
  if (!prev) return true;
  return prev.sentAt.slice(0, 10) !== cur.sentAt.slice(0, 10);
}
