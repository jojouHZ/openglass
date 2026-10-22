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

export const kostya: User = {
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

/** A second pending request to me — lets tests accept one and decline the other. */
export const suitor: User = {
  id: "00000000-0000-4000-8000-000000000006",
  displayName: "oleg",
  tag: "oleg#1170",
  avatarUrl: null,
  createdAt: iso(-60 * 24 * 8),
};

/** Known to the server, no relationship with me yet. */
export const stranger: User = {
  id: "00000000-0000-4000-8000-000000000007",
  displayName: "nina",
  tag: "nina#6402",
  avatarUrl: null,
  createdAt: iso(-60 * 24 * 6),
};

/** A pending request FROM me — never a contact until she accepts. */
export const lena: User = {
  id: "00000000-0000-4000-8000-000000000008",
  displayName: "lena",
  tag: "lena#2290",
  avatarUrl: null,
  createdAt: iso(-60 * 24 * 7),
};

export const allUsers = [selfUser, wife, kostya, incomingOnly, groupPal, suitor, stranger, lena];

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
/** Saved Messages — a direct chat where peer === self (S4 top row). */
export const savedChatId = "c0000000-0000-4000-8000-000000000003";

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

/** ~60-message history in the direct chat, oldest → newest.
    >50 so cursor pagination is exercisable from the mock. */
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
  for (let seq = 6; seq <= 60; seq++) {
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

export function buildSavedHistory(): Message[] {
  return [
    {
      id: "m0000000-0000-4000-8000-0000000000a1",
      chatId: savedChatId,
      seq: 1,
      senderId: selfUser.id,
      text: "draft: deploy checklist",
      clientNonce: "fixture-s1",
      sentAt: iso(-90),
      pinned: false,
    },
  ];
}

export function buildChats(
  directHistory: Message[],
  groupHistory: Message[],
  savedHistory: Message[],
): { chats: Chat[]; summaries: ChatSummary[] } {
  const chats: Chat[] = [
    {
      id: savedChatId,
      type: "direct",
      title: null,
      peer: selfUser,
      createdAt: iso(-60 * 24 * 7),
    },
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
      id: savedChatId,
      type: "direct",
      title: null,
      peer: selfUser,
      lastMessage: savedHistory.at(-1),
      lastActivityAt: savedHistory.at(-1)!.sentAt,
      unreadCount: 0,
      pinned: true, // always top — saved messages
    },
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
  { user: groupPal, mutual: true, addedAt: iso(-60 * 24 * 6), verifiedAt: null },
  { user: kostya, mutual: true, addedAt: iso(-60 * 24 * 5), verifiedAt: null },
];

/** Pending contact requests: lena was asked by me, incomingOnly/suitor asked me. */
export const outgoingRequests = [{ user: lena, createdAt: iso(-60 * 24 * 5) }];
export const incomingRequests = [
  { user: incomingOnly, createdAt: iso(-60 * 24 * 2) },
  { user: suitor, createdAt: iso(-60 * 24) },
];

/** A group invitation addressed to me (the group is invisible until accepted). */
export const groupInviteFx = {
  chatId: "c0000000-0000-4000-8000-000000000009",
  title: "book club",
  memberCount: 3,
  inviter: groupPal,
  createdAt: iso(-60 * 24),
};

export const demoAttachment: Attachment = {
  id: "a0000000-0000-4000-8000-000000000001",
  kind: "photo",
  mimeType: "image/png",
  fileName: "screenshot.png",
  sizeBytes: 42_000,
  url: "/api/v1/attachments/a0000000-0000-4000-8000-000000000001",
  thumbnailUrl: null,
};
