// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// MSW handlers for the whole public REST contract. The mock answers
// real HTTP requests from HttpApiClient — fixtures are typed from the
// generated schema, so drift fails at compile time.
// Stateful only where the contract demands it (nonce dedup, cursors,
// pins, unread). No ordering engine, no hub, no timers beyond latency.

import { delay, http, HttpResponse } from "msw";

import type {
  Chat,
  ChatSummary,
  Contact,
  GroupMember,
  Message,
  User,
} from "../client";
import { DEMO_INVITE, DEMO_OTP, demoAttachment, selfUser } from "./fixtures";
import { freshId, MockState } from "./state";

const API = "*/api/v1";
const LATENCY_MS = 80;

const err = (status: number, code: string, message: string, details?: Record<string, unknown>) =>
  HttpResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });

const ok = (body: object, status = 200) => HttpResponse.json(body, { status });
const empty = () => new HttpResponse(null, { status: 204 });

/** Opaque cursor — seq-based per docs/api/public-api.openapi.yaml. */
const encodeCursor = (seq: number) => btoa(`seq:${seq}`);
const decodeCursor = (c: string | null): number | null => {
  if (!c) return null;
  try {
    const m = /^seq:(\d+)$/.exec(atob(c));
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
};

export function createHandlers(state: MockState) {
  const ACCESS = "mock-access-token";
  const REFRESH = "mock-refresh-token";

  const authed = (request: Request) =>
    request.headers.get("authorization") === `Bearer ${ACCESS}`;

  const guard = (request: Request) =>
    authed(request) ? null : err(401, "unauthorized", "Missing or invalid access token");

  const findMessage = (id: string) => {
    for (const list of state.messages.values()) {
      const m = list.find((x) => x.id === id);
      if (m) return m;
    }
    return undefined;
  };

  return [
    // ---------- system ----------
    http.get("*/healthz", async () => {
      await delay(LATENCY_MS);
      return ok({ status: "ok", postgres: "up", redis: "up" });
    }),

    // ---------- auth ----------
    http.post(`${API}/auth/otp/request`, async ({ request }) => {
      await delay(LATENCY_MS);
      const { email, inviteCode } = (await request.json()) as {
        email: string;
        inviteCode?: string;
      };
      if (!state.knownEmails.has(email)) {
        if (!inviteCode)
          return err(403, "invite_required", "This email has no account yet — an invite is required");
        if (inviteCode !== DEMO_INVITE)
          return err(403, "invite_invalid", "Invite code is not valid");
      }
      state.pendingOtpEmail = email;
      return ok({ otpExpiresInS: 600, resendAvailableInS: 60 }, 202);
    }),

    http.post(`${API}/auth/otp/verify`, async ({ request }) => {
      await delay(LATENCY_MS);
      const { email, code } = (await request.json()) as { email: string; code: string };
      if (code !== DEMO_OTP)
        return err(400, "otp_invalid", "Wrong code", { attemptsLeft: 4 });
      const needsProfile = !state.profileDone.has(email);
      const user = state.knownEmails.get(email) ?? null;
      state.session = { email, user: needsProfile ? null : user, accessToken: ACCESS };
      return ok({
        needsProfile,
        accessToken: ACCESS,
        accessTokenExpiresInS: 900,
        refreshToken: REFRESH,
        user: needsProfile ? null : user,
      });
    }),

    http.post(`${API}/auth/profile`, async ({ request }) => {
      await delay(LATENCY_MS);
      const g = guard(request);
      if (g) return g;
      if (state.session?.user) return err(409, "conflict", "Profile already completed");
      const { displayName, requestedTag } = (await request.json()) as {
        displayName: string;
        requestedTag?: string;
      };
      const taken = (t: string) =>
        [...state.users.values()].some((u) => u.tag.toLowerCase() === t.toLowerCase());
      let tag = requestedTag ?? `${displayName.toLowerCase().replace(/\W+/g, "")}#${1000 + Math.floor(Math.random() * 9000)}`;
      if (taken(tag)) {
        return err(409, "tag_taken", "Requested tag is taken", {
          tagSuggestions: [`${tag.slice(0, -4)}${1000 + Math.floor(Math.random() * 9000)}`],
        });
      }
      const user: User = {
        id: freshId(),
        displayName,
        tag,
        avatarUrl: null,
        createdAt: new Date().toISOString(),
      };
      state.users.set(user.id, user);
      state.knownEmails.set(state.session!.email, user);
      state.profileDone.add(state.session!.email);
      state.session!.user = user;
      return ok({ user });
    }),

    http.post(`${API}/auth/refresh`, async () => {
      await delay(LATENCY_MS);
      return ok({
        accessToken: ACCESS,
        accessTokenExpiresInS: 900,
        refreshToken: REFRESH,
      });
    }),

    http.post(`${API}/auth/logout`, async ({ request }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      state.session = null;
      return empty();
    }),

    http.get(`${API}/auth/sessions`, async ({ request }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      return ok({ sessions: state.sessions });
    }),

    http.delete(`${API}/auth/sessions/:sessionId`, async ({ request, params }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const i = state.sessions.findIndex((s) => s.id === params.sessionId);
      if (i === -1) return err(404, "not_found", "Session not found");
      state.sessions.splice(i, 1);
      return empty();
    }),

    // ---------- users ----------
    http.get(`${API}/users/me`, async ({ request }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const user = state.session?.user ?? selfUser;
      return ok({ user, email: state.session?.email ?? "jojou@openglass.demo" });
    }),

    http.patch(`${API}/users/me`, async ({ request }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const body = (await request.json()) as { displayName?: string; avatarUrl?: string | null };
      const user = state.session?.user ?? selfUser;
      if (body.displayName) user.displayName = body.displayName;
      if (body.avatarUrl !== undefined) user.avatarUrl = body.avatarUrl;
      return ok({ user });
    }),

    http.get(`${API}/users/search`, async ({ request }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const q = new URL(request.url).searchParams.get("q")?.toLowerCase() ?? "";
      const users = [...state.users.values()].filter(
        (u) =>
          u.id !== selfUser.id &&
          (u.displayName.toLowerCase().includes(q) || u.tag.toLowerCase().includes(q)),
      );
      return ok({ users });
    }),

    http.get(`${API}/users/:userId`, async ({ request, params }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const user = state.findUser(String(params.userId));
      if (!user) return err(404, "not_found", "User not found");
      return ok({ user, verifiedAt: null, relationship: state.relationship(user.id) });
    }),

    // ---------- contacts ----------
    http.get(`${API}/contacts`, async ({ request }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      return ok({ contacts: state.contacts });
    }),

    http.post(`${API}/contacts`, async ({ request }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const { userId } = (await request.json()) as { userId: string };
      const user = state.findUser(userId);
      if (!user) return err(404, "not_found", "User not found");
      const existing = state.contacts.find((c) => c.user.id === userId);
      if (existing) return ok({ contact: existing }, 200);
      const contact: Contact = {
        user,
        mutual: state.relationship(userId) === "contact_incoming",
        addedAt: new Date().toISOString(),
        verifiedAt: null,
      };
      state.contacts.push(contact);
      return ok({ contact }, 201);
    }),

    http.delete(`${API}/contacts/:userId`, async ({ request, params }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const i = state.contacts.findIndex((c) => c.user.id === params.userId);
      if (i !== -1) state.contacts.splice(i, 1);
      return empty();
    }),

    // ---------- chats ----------
    http.get(`${API}/chats`, async ({ request }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const chats = [...state.chatSummaries.values()].sort(
        (a, b) =>
          Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
          b.lastActivityAt.localeCompare(a.lastActivityAt),
      );
      return ok({ chats });
    }),

    http.post(`${API}/chats`, async ({ request }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const { userId } = (await request.json()) as { userId: string };
      const peer = state.findUser(userId);
      if (!peer) return err(404, "not_found", "User not found");
      const existing = [...state.chats.values()].find(
        (c) => c.type === "direct" && c.peer?.id === userId,
      );
      if (existing) return ok({ chat: existing }, 200);
      const chat: Chat = {
        id: freshId(),
        type: "direct",
        title: null,
        peer,
        createdAt: new Date().toISOString(),
      };
      state.chats.set(chat.id, chat);
      state.messages.set(chat.id, []);
      state.chatSummaries.set(chat.id, {
        id: chat.id,
        type: "direct",
        title: null,
        peer,
        lastActivityAt: chat.createdAt,
        unreadCount: 0,
        pinned: false,
      });
      return ok({ chat }, 201);
    }),

    http.get(`${API}/chats/:chatId`, async ({ request, params }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const chat = state.chats.get(String(params.chatId));
      if (!chat) return err(404, "not_found", "Chat not found");
      return ok({ chat });
    }),

    http.post(`${API}/chats/:chatId/pin`, async ({ request, params }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const { pinned } = (await request.json()) as { pinned: boolean };
      const s = state.chatSummaries.get(String(params.chatId));
      if (!s) return err(404, "not_found", "Chat not found");
      s.pinned = pinned;
      return empty();
    }),

    // ---------- messages ----------
    http.get(`${API}/chats/:chatId/messages`, async ({ request, params }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const url = new URL(request.url);
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 30) || 30, 100);
      const q = url.searchParams.get("q")?.toLowerCase();
      const pinnedOnly = url.searchParams.get("pinned") === "true";
      const around = url.searchParams.get("around");
      const before = decodeCursor(url.searchParams.get("before"));
      const after = decodeCursor(url.searchParams.get("after"));

      let list = [...(state.messages.get(String(params.chatId)) ?? [])].filter(
        (m) => !m.deletedAt,
      );
      if (q) list = list.filter((m) => m.text?.toLowerCase().includes(q));
      if (pinnedOnly) list = list.filter((m) => m.pinned);

      let page: Message[];
      if (around !== null) {
        const idx = list.findIndex((m) => String(m.seq) === around || m.id === around);
        const center = idx === -1 ? list.length : idx;
        const half = Math.floor(limit / 2);
        page = list.slice(Math.max(0, center - half), center + half + 1);
      } else if (after !== null) {
        page = list.filter((m) => m.seq > after).slice(0, limit);
      } else if (before !== null) {
        page = list.filter((m) => m.seq < before).slice(-limit);
      } else {
        page = list.slice(-limit);
      }

      const first = page[0];
      const last = page.at(-1);
      return ok({
        messages: page,
        nextCursor: first && list[0]!.seq < first.seq ? encodeCursor(first.seq) : null,
        newerCursor: last && list.at(-1)!.seq > last.seq ? encodeCursor(last.seq) : null,
      });
    }),

    http.post(`${API}/chats/:chatId/messages`, async ({ request, params }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const chatId = String(params.chatId);
      if (!state.chats.has(chatId)) return err(404, "not_found", "Chat not found");
      const body = (await request.json()) as {
        clientNonce: string;
        text?: string;
        attachmentIds?: string[];
        replyToMessageId?: string;
      };
      if (!body.text && !body.attachmentIds?.length)
        return err(400, "validation_failed", "Message needs text or attachments");

      const senderId = (state.session?.user ?? selfUser).id;
      const nonceKey = `${senderId}:${body.clientNonce}`;
      const dup = state.nonceIndex.get(nonceKey);
      if (dup) return ok({ message: dup }, 200); // idempotent retry

      const message: Message = {
        id: freshId(),
        chatId,
        seq: state.nextSeq(chatId),
        senderId,
        text: body.text ?? null,
        replyToMessageId: body.replyToMessageId ?? null,
        clientNonce: body.clientNonce,
        sentAt: new Date().toISOString(),
        pinned: false,
      };
      state.messages.get(chatId)!.push(message);
      state.nonceIndex.set(nonceKey, message);
      const s = state.chatSummaries.get(chatId);
      if (s) {
        s.lastMessage = message;
        s.lastActivityAt = message.sentAt;
      }
      return ok({ message }, 201);
    }),

    http.patch(`${API}/messages/:messageId`, async ({ request, params }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const m = findMessage(String(params.messageId));
      if (!m) return err(404, "not_found", "Message not found");
      const { text } = (await request.json()) as { text: string };
      m.text = text;
      m.editedAt = new Date().toISOString();
      return ok({ message: m });
    }),

    http.delete(`${API}/messages/:messageId`, async ({ request, params }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const m = findMessage(String(params.messageId));
      if (!m) return err(404, "not_found", "Message not found");
      m.deletedAt = new Date().toISOString();
      m.text = null;
      return empty();
    }),

    http.post(`${API}/messages/:messageId/pin`, async ({ request, params }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const m = findMessage(String(params.messageId));
      if (!m) return err(404, "not_found", "Message not found");
      const { pinned } = (await request.json()) as { pinned: boolean };
      m.pinned = pinned;
      return ok({ message: m });
    }),

    http.post(`${API}/chats/:chatId/attachments`, async ({ request }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const fd = await request.formData();
      const file = fd.get("file");
      const attachment = {
        ...demoAttachment,
        id: freshId(),
        fileName: file instanceof File ? file.name : "file.bin",
        mimeType: file instanceof File ? file.type || "application/octet-stream" : "application/octet-stream",
        sizeBytes: file instanceof File ? file.size : 0,
        kind: file instanceof File && file.type.startsWith("image/") ? ("photo" as const) : ("file" as const),
        url: `/api/v1/attachments/${freshId()}`,
      };
      return ok({ attachment }, 201);
    }),

    http.post(`${API}/chats/:chatId/read`, async ({ request, params }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const s = state.chatSummaries.get(String(params.chatId));
      if (s) s.unreadCount = 0;
      return empty();
    }),

    // ---------- groups ----------
    http.post(`${API}/groups`, async ({ request }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const { title, memberIds } = (await request.json()) as { title: string; memberIds: string[] };
      const members: GroupMember[] = [
        {
          user: state.session?.user ?? selfUser,
          role: "owner",
          rights: { inviteMembers: true, removeMembers: true, editInfo: true, pinMessages: true, deleteMessages: true },
          joinedAt: new Date().toISOString(),
        },
        ...memberIds
          .map((id) => state.findUser(id))
          .filter((u): u is User => !!u)
          .map((u) => ({
            user: u,
            role: "member" as const,
            rights: { inviteMembers: false, removeMembers: false, editInfo: false, pinMessages: false, deleteMessages: false },
            joinedAt: new Date().toISOString(),
          })),
      ];
      const chat: Chat = {
        id: freshId(),
        type: "group",
        title,
        members,
        createdAt: new Date().toISOString(),
      };
      state.chats.set(chat.id, chat);
      state.members.set(chat.id, members);
      state.messages.set(chat.id, []);
      const summary: ChatSummary = {
        id: chat.id,
        type: "group",
        title,
        lastActivityAt: chat.createdAt,
        unreadCount: 0,
        memberCount: members.length,
        pinned: false,
      };
      state.chatSummaries.set(chat.id, summary);
      return ok({ chat }, 201);
    }),

    http.patch(`${API}/groups/:chatId`, async ({ request, params }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const chat = state.chats.get(String(params.chatId));
      if (!chat) return err(404, "not_found", "Chat not found");
      const { title } = (await request.json()) as { title?: string };
      if (title) {
        chat.title = title;
        const s = state.chatSummaries.get(chat.id);
        if (s) s.title = title;
      }
      return ok({ chat });
    }),

    http.post(`${API}/groups/:chatId/members`, async ({ request, params }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const { memberIds } = (await request.json()) as { memberIds: string[] };
      const members = state.members.get(String(params.chatId));
      const chat = state.chats.get(String(params.chatId));
      if (!members || !chat) return err(404, "not_found", "Chat not found");
      for (const id of memberIds) {
        const u = state.findUser(id);
        if (u && !members.some((m) => m.user.id === id)) {
          members.push({
            user: u,
            role: "member",
            rights: { inviteMembers: false, removeMembers: false, editInfo: false, pinMessages: false, deleteMessages: false },
            joinedAt: new Date().toISOString(),
          });
        }
      }
      chat.members = members;
      return empty();
    }),

    http.delete(`${API}/groups/:chatId/members/:userId`, async ({ request, params }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const members = state.members.get(String(params.chatId));
      if (!members) return err(404, "not_found", "Chat not found");
      const i = members.findIndex((m) => m.user.id === params.userId);
      if (i !== -1) members.splice(i, 1);
      return empty();
    }),

    http.patch(`${API}/groups/:chatId/members/:userId`, async ({ request, params }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const members = state.members.get(String(params.chatId));
      const member = members?.find((m) => m.user.id === params.userId);
      if (!member) return err(404, "not_found", "Member not found");
      const { rights } = (await request.json()) as { rights: import("../client").MemberRights };
      member.rights = { ...member.rights, ...rights };
      return ok({ member });
    }),

    http.post(`${API}/groups/:chatId/ownership`, async ({ request, params }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const members = state.members.get(String(params.chatId));
      const { newOwnerId } = (await request.json()) as { newOwnerId: string };
      const target = members?.find((m) => m.user.id === newOwnerId);
      if (!members || !target) return err(404, "not_found", "Member not found");
      for (const m of members) m.role = m === target ? "owner" : "member";
      return empty();
    }),

    // ---------- push ----------
    http.get(`${API}/push/vapid-key`, async ({ request }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      return ok({ publicKey: "BMOCKvapidkey0000000000000000000000000000000000000000000000000000000000000" });
    }),

    http.post(`${API}/push/subscriptions`, async ({ request }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      const { endpoint } = (await request.json()) as { endpoint: string };
      for (const [id, sub] of state.pushSubscriptions) {
        if (sub.endpoint === endpoint) return ok({ id }, 200); // upsert
      }
      const id = freshId();
      state.pushSubscriptions.set(id, { endpoint });
      return ok({ id }, 201);
    }),

    http.delete(`${API}/push/subscriptions/:subscriptionId`, async ({ request, params }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      state.pushSubscriptions.delete(String(params.subscriptionId));
      return empty();
    }),

    // ---------- reports ----------
    http.post(`${API}/reports`, async ({ request }) => {
      const g = guard(request);
      if (g) return g;
      await delay(LATENCY_MS);
      return ok({}, 202);
    }),
  ];
}
