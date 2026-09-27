// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Typed demo fixtures — fields come from the generated OpenAPI types,
// so contract drift fails at compile time, not in the browser.
// Scenario is deliberately small but covers every screen: a mutual
// contact (wife), an outgoing-only contact, an incoming request,
// a direct chat with history + pin + unread, and a group with rights.

import type {
  Attachment,
  Chat,
  ChatSummary,
  Contact,
  DeviceSession,
  GroupMember,
  Message,
  User,
} from "../client";

export const DEMO_OTP = "123456";
export const DEMO_INVITE = "GLS-DEMO";

const T0 = Date.parse("2026-09-24T09:00:00Z");
const iso = (offsetMin: number) => new Date(T0 + offsetMin * 60_000).toISOString();

export const selfUser: User = {
  id: "00000000-0000-4000-8000-000000000001",
  displayName: "jojou",
  tag: "jojou#1042",
  avatarUrl: null,
  createdAt: iso(-60 * 24 * 30),
};

export const wife: User = {
  id: "00000000-0000-4000-8000-000000000002",
  displayName: "anna",
  tag: "anna#0002",
  avatarUrl: null,
  createdAt: iso(-60 * 24 * 30),
};

export const outgoingOnly: User = {
  id: "00000000-0000-4000-8000-000000000003",
  displayName: "kostya",
  tag: "kostya#3307",
  avatarUrl: null,
  createdAt: iso(-60 * 24 * 20),
};

export const incomingOnly: User = {
  id: "00000000-0000-4000-8000-000000000004",
  displayName: "mira",
  tag: "mira#8821",
  avatarUrl: null,
  createdAt: iso(-60 * 24 * 10),
};

export const groupPal: User = {
  id: "00000000-0000-4000-8000-000000000005",
  displayName: "dima",
  tag: "dima#5150",
  avatarUrl: null,
  createdAt: iso(-60 * 24 * 10),
};

export const allUsers = [selfUser, wife, outgoingOnly, incomingOnly, groupPal];

export const sessions: DeviceSession[] = [
  {
    id: "d0000000-0000-4000-8000-000000000001",
    deviceName: "This device — Chrome PWA",
    createdAt: iso(-60 * 24 * 30),
    lastSeenAt: iso(0),
    current: true,
  },
  {
    id: "d0000000-0000-4000-8000-000000000002",
    deviceName: "Pixel 8 — Chrome PWA",
    createdAt: iso(-60 * 24 * 12),
    lastSeenAt: iso(-60 * 4),
    current: false,
  },
];

export const directChatId = "c0000000-0000-4000-8000-000000000001";
export const groupChatId = "c0000000-0000-4000-8000-000000000002";

const msg = (
  seq: number,
  senderId: string,
  text: string,
  extra: Partial<Message> = {},
): Message => ({
  id: `m0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
  chatId: directChatId,
  seq,
  senderId,
  text,
  clientNonce: `fixture-${seq}`,
  sentAt: iso(seq * 3),
  pinned: false,
  ...extra,
});

/** ~30-message history in the direct chat, oldest → newest. */
export function buildDirectHistory(): Message[] {
  const seed: Array<[number, string, string]> = [
    [1, wife.id, "hi! testing openglass"],
    [2, selfUser.id, "works! server-side history, public layer"],
    [3, wife.id, "and the private layer?"],
    [4, selfUser.id, "private lives on the pwa-dev host only — not here"],
    [5, wife.id, "got it. pinning this one"],
  ];
  const msgs = seed.map(([seq, sender, text]) =>
    msg(seq, sender, text, seq === 5 ? { pinned: true } : {}),
  );
  for (let seq = 6; seq <= 30; seq++) {
    const sender = seq % 2 === 0 ? selfUser.id : wife.id;
    msgs.push(msg(seq, sender, `fixture message ${seq}`));
  }
  return msgs;
}

export function buildGroupHistory(): Message[] {
  return [1, 2, 3].map((seq) => ({
    ...msg(seq, [selfUser.id, groupPal.id, wife.id][seq - 1]!, `group msg ${seq}`),
    id: `m0000000-0000-4000-8000-0000000000${40 + seq}`,
    chatId: groupChatId,
    clientNonce: `fixture-g${seq}`,
  }));
}

export const groupMembers: GroupMember[] = [
  {
    user: selfUser,
    role: "owner",
    rights: {
      inviteMembers: true,
      removeMembers: true,
      editInfo: true,
      pinMessages: true,
      deleteMessages: true,
    },
    joinedAt: iso(-60 * 24 * 7),
  },
  {
    user: wife,
    role: "member",
    rights: {
      inviteMembers: true,
      removeMembers: false,
      editInfo: false,
      pinMessages: false,
      deleteMessages: false,
    },
    joinedAt: iso(-60 * 24 * 7),
  },
  {
    user: groupPal,
    role: "member",
    rights: {
      inviteMembers: false,
      removeMembers: false,
      editInfo: false,
      pinMessages: false,
      deleteMessages: false,
    },
    joinedAt: iso(-60 * 24 * 6),
  },
];

export function buildChats(
  directHistory: Message[],
  groupHistory: Message[],
): { chats: Chat[]; summaries: ChatSummary[] } {
  const chats: Chat[] = [
    {
      id: directChatId,
      type: "direct",
      title: null,
      peer: wife,
      createdAt: iso(-60 * 24 * 7),
    },
    {
      id: groupChatId,
      type: "group",
      title: "family ops",
      members: groupMembers,
      createdAt: iso(-60 * 24 * 7),
    },
  ];
  const summaries: ChatSummary[] = [
    {
      id: groupChatId,
      type: "group",
      title: "family ops",
      lastMessage: groupHistory.at(-1),
      lastActivityAt: groupHistory.at(-1)!.sentAt,
      unreadCount: 0,
      memberCount: groupMembers.length,
      pinned: true,
    },
    {
      id: directChatId,
      type: "direct",
      title: null,
      peer: wife,
      lastMessage: directHistory.at(-1),
      lastActivityAt: directHistory.at(-1)!.sentAt,
      unreadCount: 3,
      pinned: false,
    },
  ];
  return { chats, summaries };
}

export const contacts: Contact[] = [
  { user: wife, mutual: true, addedAt: iso(-60 * 24 * 7), verifiedAt: null },
  { user: outgoingOnly, mutual: false, addedAt: iso(-60 * 24 * 5), verifiedAt: null },
  { user: groupPal, mutual: true, addedAt: iso(-60 * 24 * 6), verifiedAt: null },
];

export const demoAttachment: Attachment = {
  id: "a0000000-0000-4000-8000-000000000001",
  kind: "photo",
  mimeType: "image/png",
  fileName: "screenshot.png",
  sizeBytes: 42_000,
  url: "/api/v1/attachments/a0000000-0000-4000-8000-000000000001",
  thumbnailUrl: null,
};
