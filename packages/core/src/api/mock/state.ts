// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// In-memory mock state — one instance per MSW server/worker.
// Minimal statefulness only where the contract demands it:
// clientNonce dedup, pagination cursors, pin/unread flags.
// NOT a chat simulator: no ordering engine, no TTLs, no hub.

import type {
  Chat,
  ChatSummary,
  Contact,
  DeviceSession,
  GroupMember,
  Message,
  User,
} from "../client";
import * as fx from "./fixtures";

export interface MockSession {
  email: string;
  user: User | null; // null until completeProfile
  accessToken: string;
}

export class MockState {
  readonly users = new Map<string, User>();
  /** emails that already have an account (no invite needed to re-login) */
  readonly knownEmails = new Map<string, User>();
  readonly contacts: Contact[] = [];
  readonly sessions: DeviceSession[] = [];
  readonly chats = new Map<string, Chat>();
  readonly chatSummaries = new Map<string, ChatSummary>();
  readonly messages = new Map<string, Message[]>();
  /** (senderId, clientNonce) → message — send idempotency */
  readonly nonceIndex = new Map<string, Message>();
  /** emails with a completed profile */
  readonly profileDone = new Set<string>();
  readonly members = new Map<string, GroupMember[]>();
  readonly pushSubscriptions = new Map<string, { endpoint: string }>();
  chatPinned = new Map<string, boolean>();

  pendingOtpEmail: string | null = null;
  session: MockSession | null = null;
  private seqCounters = new Map<string, number>();

  constructor() {
    for (const u of fx.allUsers) this.users.set(u.id, u);
    this.knownEmails.set("jojou@openglass.demo", fx.selfUser);
    this.knownEmails.set("anna@openglass.demo", fx.wife);
    this.profileDone.add("jojou@openglass.demo");
    this.contacts.push(...fx.contacts);
    this.sessions.push(...fx.sessions);

    const direct = fx.buildDirectHistory();
    const group = fx.buildGroupHistory();
    const saved = fx.buildSavedHistory();
    this.messages.set(fx.directChatId, direct);
    this.messages.set(fx.groupChatId, group);
    this.messages.set(fx.savedChatId, saved);
    const { chats, summaries } = fx.buildChats(direct, group, saved);
    for (const c of chats) this.chats.set(c.id, c);
    for (const s of summaries) this.chatSummaries.set(s.id, s);
    this.chatPinned.set(fx.groupChatId, true);
    this.members.set(fx.groupChatId, [...fx.groupMembers]);
    this.seqCounters.set(fx.directChatId, direct.length);
    this.seqCounters.set(fx.groupChatId, group.length);
  }

  nextSeq(chatId: string): number {
    const n = (this.seqCounters.get(chatId) ?? 0) + 1;
    this.seqCounters.set(chatId, n);
    return n;
  }

  findUser(id: string): User | undefined {
    return this.users.get(id);
  }

  relationship(userId: string): "none" | "contact_incoming" | "contact_outgoing" | "contact_mutual" | "self" {
    if (userId === fx.selfUser.id) return "self";
    const out = this.contacts.find((c) => c.user.id === userId);
    if (out) return out.mutual ? "contact_mutual" : "contact_outgoing";
    if (userId === fx.incomingOnly.id) return "contact_incoming";
    return "none";
  }
}

let counter = 0;
export const freshId = () =>
  `f0000000-0000-4000-8000-${String(counter++).padStart(12, "0")}`;
