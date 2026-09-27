// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// ApiClient — the single seam between frontend and backend.
// Mock (MSW+fixtures) and real (HTTP+WS) implementations both satisfy
// this interface; selected by VITE_API_MODE=mock|live.
// Shapes come from docs/api/public-api.openapi.yaml — never hand-edit
// type fields; amend the contract first.

import type { components } from "./schema.gen";
import type { ServerEvent } from "./events";

export type User = components["schemas"]["User"];
export type DeviceSession = components["schemas"]["DeviceSession"];
export type Contact = components["schemas"]["Contact"];
export type Chat = components["schemas"]["Chat"];
export type ChatSummary = components["schemas"]["ChatSummary"];
export type GroupMember = components["schemas"]["GroupMember"];
export type MemberRights = components["schemas"]["MemberRights"];
export type Message = components["schemas"]["Message"];
export type Attachment = components["schemas"]["Attachment"];

export type Relationship =
  | "none"
  | "contact_incoming"
  | "contact_outgoing"
  | "contact_mutual"
  | "self";

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly apiError: ApiError,
  ) {
    super(apiError.message);
    this.name = "ApiRequestError";
  }
}

// --- request/response aliases (generated from the spec) ---

export interface OtpRequestBody {
  email: string;
  inviteCode?: string;
}
export interface OtpRequestResult {
  otpExpiresInS: number;
  resendAvailableInS: number;
}
export interface VerifyOtpResult {
  needsProfile: boolean;
  accessToken: string;
  accessTokenExpiresInS: number;
  refreshToken: string;
  user: User | null;
}
export interface TokenPair {
  accessToken: string;
  accessTokenExpiresInS: number;
  refreshToken: string;
}
export interface MessagePage {
  messages: Message[];
  nextCursor: string | null;
  newerCursor: string | null;
}
export interface ListMessagesParams {
  before?: string;
  after?: string;
  limit?: number;
  q?: string;
  pinned?: boolean;
  around?: string;
}
export interface SendMessageBody {
  clientNonce: string;
  text?: string;
  attachmentIds?: string[];
  replyToMessageId?: string;
}

export type Unsubscribe = () => void;

/** Realtime channel — see docs/api/ws-events.md. */
export interface ApiEvents {
  /**
   * Open the socket and complete first-frame auth with the current access
   * token. `lastSeq` enables server-side replay of missed frames; omitted
   * on a fresh session.
   */
  connect(accessToken: string, lastSeq?: number): Promise<void>;
  disconnect(): void;
  /** Connection lifecycle for UI (reconnecting / offline states). */
  onStateChange(cb: (state: "connecting" | "online" | "offline") => void): Unsubscribe;
  on<T extends ServerEvent["type"]>(
    type: T,
    cb: (ev: Extract<ServerEvent, { type: T }>) => void,
  ): Unsubscribe;
  typingStart(chatId: string): void;
  typingStop(chatId: string): void;
  receiptRead(chatId: string, upToSeq: number): void;
  ping(): void;
}

export interface ApiClient {
  auth: {
    requestOtp(body: OtpRequestBody): Promise<OtpRequestResult>;
    verifyOtp(body: {
      email: string;
      code: string;
      deviceName: string;
    }): Promise<VerifyOtpResult>;
    completeProfile(body: {
      displayName: string;
      requestedTag?: string;
    }): Promise<{ user: User }>;
    refresh(refreshToken: string): Promise<TokenPair>;
    logout(): Promise<void>;
    listSessions(): Promise<{ sessions: DeviceSession[] }>;
    revokeSession(sessionId: string): Promise<void>;
  };
  users: {
    getMe(): Promise<{ user: User; email: string }>;
    updateMe(body: {
      displayName?: string;
      avatarUrl?: string | null;
    }): Promise<{ user: User }>;
    search(q: string): Promise<{ users: User[] }>;
    get(userId: string): Promise<{ user: User; verifiedAt: string | null; relationship: Relationship }>;
  };
  contacts: {
    list(): Promise<{ contacts: Contact[] }>;
    add(userId: string): Promise<{ contact: Contact }>;
    remove(userId: string): Promise<void>;
  };
  chats: {
    list(): Promise<{ chats: ChatSummary[] }>;
    openDirect(userId: string): Promise<{ chat: Chat }>;
    get(chatId: string): Promise<{ chat: Chat }>;
    setPinned(chatId: string, pinned: boolean): Promise<void>;
  };
  messages: {
    list(chatId: string, params?: ListMessagesParams): Promise<MessagePage>;
    send(chatId: string, body: SendMessageBody): Promise<{ message: Message }>;
    edit(messageId: string, text: string): Promise<{ message: Message }>;
    delete(messageId: string): Promise<void>;
    setPinned(messageId: string, pinned: boolean): Promise<{ message: Message }>;
    uploadAttachment(chatId: string, file: File): Promise<{ attachment: Attachment }>;
    markRead(chatId: string, upToSeq: number): Promise<void>;
  };
  groups: {
    create(body: { title: string; memberIds: string[] }): Promise<{ chat: Chat }>;
    edit(chatId: string, body: { title?: string }): Promise<{ chat: Chat }>;
    addMembers(chatId: string, memberIds: string[]): Promise<void>;
    removeMember(chatId: string, userId: string): Promise<void>;
    setMemberRights(chatId: string, userId: string, rights: MemberRights): Promise<{ member: GroupMember }>;
    transferOwnership(chatId: string, newOwnerId: string): Promise<void>;
  };
  push: {
    getVapidKey(): Promise<{ publicKey: string }>;
    subscribe(body: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    }): Promise<{ id: string }>;
    unsubscribe(subscriptionId: string): Promise<void>;
  };
  reports: {
    report(body: { userId: string; reason: string }): Promise<void>;
  };
  events: ApiEvents;
}
