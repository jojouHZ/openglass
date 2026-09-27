// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  ApiClient,
  ApiEvents,
  ListMessagesParams,
  MessagePage,
  MemberRights,
  SendMessageBody,
} from "../client";
import type { CreateApiOptions } from "../factory";
import { HttpTransport } from "./transport";
import { WsClient } from "./ws";

/**
 * Real REST+WS client for the OpenGlass contract. Same instance is used
 * in live mode (real backend) and in mock mode (MSW intercepts the same
 * requests) — the mock never replaces this code path, it answers it.
 */
export class HttpApiClient implements ApiClient {
  private accessToken: string | null = null;
  private readonly t: HttpTransport;
  readonly events: ApiEvents;

  constructor(opts: CreateApiOptions, events?: ApiEvents) {
    this.t = new HttpTransport(opts.baseUrl, () => this.accessToken);
    this.events = events ?? new WsClient(opts.wsUrl);
  }

  /** Called by the app after verifyOtp/refresh — token lives in memory. */
  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  readonly auth = {
    requestOtp: (body: { email: string; inviteCode?: string }) =>
      this.t.request<{ otpExpiresInS: number; resendAvailableInS: number }>({
        method: "POST",
        path: "/auth/otp/request",
        body,
      }),
    verifyOtp: (body: { email: string; code: string; deviceName: string }) =>
      this.t.request<import("../client").VerifyOtpResult>({
        method: "POST",
        path: "/auth/otp/verify",
        body,
      }),
    completeProfile: (body: { displayName: string; requestedTag?: string }) =>
      this.t.request<{ user: import("../client").User }>({
        method: "POST",
        path: "/auth/profile",
        body,
      }),
    refresh: (refreshToken: string) =>
      this.t.request<import("../client").TokenPair>({
        method: "POST",
        path: "/auth/refresh",
        body: { refreshToken },
      }),
    logout: () =>
      this.t.request<void>({ method: "POST", path: "/auth/logout" }),
    listSessions: () =>
      this.t.request<{ sessions: import("../client").DeviceSession[] }>({
        method: "GET",
        path: "/auth/sessions",
      }),
    revokeSession: (sessionId: string) =>
      this.t.request<void>({
        method: "DELETE",
        path: `/auth/sessions/${sessionId}`,
      }),
  };

  readonly users = {
    getMe: () =>
      this.t.request<{ user: import("../client").User; email: string }>({
        method: "GET",
        path: "/users/me",
      }),
    updateMe: (body: { displayName?: string; avatarUrl?: string | null }) =>
      this.t.request<{ user: import("../client").User }>({
        method: "PATCH",
        path: "/users/me",
        body,
      }),
    search: (q: string) =>
      this.t.request<{ users: import("../client").User[] }>({
        method: "GET",
        path: "/users/search",
        query: { q },
      }),
    get: (userId: string) =>
      this.t.request<{
        user: import("../client").User;
        verifiedAt: string | null;
        relationship: import("../client").Relationship;
      }>({ method: "GET", path: `/users/${userId}` }),
  };

  readonly contacts = {
    list: () =>
      this.t.request<{ contacts: import("../client").Contact[] }>({
        method: "GET",
        path: "/contacts",
      }),
    add: (userId: string) =>
      this.t.request<{ contact: import("../client").Contact }>({
        method: "POST",
        path: "/contacts",
        body: { userId },
      }),
    remove: (userId: string) =>
      this.t.request<void>({ method: "DELETE", path: `/contacts/${userId}` }),
  };

  readonly chats = {
    list: () =>
      this.t.request<{ chats: import("../client").ChatSummary[] }>({
        method: "GET",
        path: "/chats",
      }),
    openDirect: (userId: string) =>
      this.t.request<{ chat: import("../client").Chat }>({
        method: "POST",
        path: "/chats",
        body: { userId },
      }),
    get: (chatId: string) =>
      this.t.request<{ chat: import("../client").Chat }>({
        method: "GET",
        path: `/chats/${chatId}`,
      }),
    setPinned: (chatId: string, pinned: boolean) =>
      this.t.request<void>({
        method: "POST",
        path: `/chats/${chatId}/pin`,
        body: { pinned },
      }),
  };

  readonly messages = {
    list: (chatId: string, params: ListMessagesParams = {}) =>
      this.t.request<MessagePage>({
        method: "GET",
        path: `/chats/${chatId}/messages`,
        query: {
          before: params.before,
          after: params.after,
          limit: params.limit,
          q: params.q,
          pinned: params.pinned,
          around: params.around,
        },
      }),
    send: (chatId: string, body: SendMessageBody) =>
      this.t.request<{ message: import("../client").Message }>({
        method: "POST",
        path: `/chats/${chatId}/messages`,
        body,
      }),
    edit: (messageId: string, text: string) =>
      this.t.request<{ message: import("../client").Message }>({
        method: "PATCH",
        path: `/messages/${messageId}`,
        body: { text },
      }),
    delete: (messageId: string) =>
      this.t.request<void>({
        method: "DELETE",
        path: `/messages/${messageId}`,
      }),
    setPinned: (messageId: string, pinned: boolean) =>
      this.t.request<{ message: import("../client").Message }>({
        method: "POST",
        path: `/messages/${messageId}/pin`,
        body: { pinned },
      }),
    uploadAttachment: (chatId: string, file: File) =>
      this.t.request<{ attachment: import("../client").Attachment }>({
        method: "POST",
        path: `/chats/${chatId}/attachments`,
        file,
      }),
    markRead: (chatId: string, upToSeq: number) =>
      this.t.request<void>({
        method: "POST",
        path: `/chats/${chatId}/read`,
        body: { upToSeq },
      }),
  };

  readonly groups = {
    create: (body: { title: string; memberIds: string[] }) =>
      this.t.request<{ chat: import("../client").Chat }>({
        method: "POST",
        path: "/groups",
        body,
      }),
    edit: (chatId: string, body: { title?: string }) =>
      this.t.request<{ chat: import("../client").Chat }>({
        method: "PATCH",
        path: `/groups/${chatId}`,
        body,
      }),
    addMembers: (chatId: string, memberIds: string[]) =>
      this.t.request<void>({
        method: "POST",
        path: `/groups/${chatId}/members`,
        body: { memberIds },
      }),
    removeMember: (chatId: string, userId: string) =>
      this.t.request<void>({
        method: "DELETE",
        path: `/groups/${chatId}/members/${userId}`,
      }),
    setMemberRights: (chatId: string, userId: string, rights: MemberRights) =>
      this.t.request<{ member: import("../client").GroupMember }>({
        method: "PATCH",
        path: `/groups/${chatId}/members/${userId}`,
        body: { rights },
      }),
    transferOwnership: (chatId: string, newOwnerId: string) =>
      this.t.request<void>({
        method: "POST",
        path: `/groups/${chatId}/ownership`,
        body: { newOwnerId },
      }),
  };

  readonly push = {
    getVapidKey: () =>
      this.t.request<{ publicKey: string }>({
        method: "GET",
        path: "/push/vapid-key",
      }),
    subscribe: (body: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    }) =>
      this.t.request<{ id: string }>({
        method: "POST",
        path: "/push/subscriptions",
        body,
      }),
    unsubscribe: (subscriptionId: string) =>
      this.t.request<void>({
        method: "DELETE",
        path: `/push/subscriptions/${subscriptionId}`,
      }),
  };

  readonly reports = {
    report: (body: { userId: string; reason: string }) =>
      this.t.request<void>({ method: "POST", path: "/reports", body }),
  };

  readonly system = {
    healthz: () =>
      this.t.request<{
        status: "ok";
        postgres?: "up" | "down";
        redis?: "up" | "down";
      }>({ method: "GET", path: "/healthz", absolute: true }),
  };
}

export function createHttpApiClient(opts: CreateApiOptions): ApiClient {
  return new HttpApiClient(opts);
}
