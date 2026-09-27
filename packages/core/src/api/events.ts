// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// WebSocket event catalog — mirrors docs/api/ws-events.md.
// Server→client frames only; client→server frames are send helpers on
// ApiClient.events.

import type { components } from "./schema.gen";

type User = components["schemas"]["User"];
type Chat = components["schemas"]["Chat"];
type Message = components["schemas"]["Message"];

export type ServerEvent =
  | { type: "message.new"; seq: number; ts: string; data: Message }
  | { type: "message.edited"; seq: number; ts: string; data: Message }
  | {
      type: "message.deleted";
      seq: number;
      ts: string;
      data: { chatId: string; messageId: string; seq: number };
    }
  | {
      type: "message.pinned" | "message.unpinned";
      seq: number;
      ts: string;
      data: { chatId: string; messageId: string };
    }
  | {
      type: "presence.snapshot";
      seq: number;
      ts: string;
      data: { onlineUserIds: string[] };
    }
  | {
      type: "typing";
      seq: number;
      ts: string;
      data: { chatId: string; userId: string; until: string };
    }
  | {
      type: "receipt.read";
      seq: number;
      ts: string;
      data: { chatId: string; userId: string; upToSeq: number };
    }
  | {
      type: "presence";
      seq: number;
      ts: string;
      data: { userId: string; status: "online" | "offline" };
    }
  | { type: "contact.added"; seq: number; ts: string; data: { user: User } }
  | { type: "contact.removed"; seq: number; ts: string; data: { userId: string } }
  | { type: "user.updated"; seq: number; ts: string; data: { user: User } }
  | { type: "chat.updated"; seq: number; ts: string; data: { chat: Chat } }
  | { type: "chat.new"; seq: number; ts: string; data: { chat: Chat } }
  | { type: "pong"; seq: number; ts: string; data: Record<string, never> }
  | {
      type: "auth.ok";
      seq: number;
      ts: string;
      data: { resumedFromSeq: number | null };
    }
  | {
      type: "auth.fail";
      seq: number;
      ts: string;
      data: { code: "unauthorized" };
    }
  | {
      type: "resync.required";
      seq: number;
      ts: string;
      data: { reason: "gap" | "evicted" };
    }
  | {
      type: "session.revoked";
      seq: number;
      ts: string;
      data: { sessionId: string };
    };

export type ServerEventType = ServerEvent["type"];
export type ServerEventData<T extends ServerEventType> =
  Extract<ServerEvent, { type: T }>["data"];
