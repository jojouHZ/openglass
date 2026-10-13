// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

export * from "./api/client";
export * from "./api/events";
export * from "./api/factory";
export * from "./stores/session";
export * from "./stores/chats";
export * from "./stores/contacts";

/** Injection key for the private-layer remote facade — the public name
 *  of the host↔remote contract. The implementation
 *  (@openglass/core/private/remote) stays dev-host only. */
export const PRIVATE_REMOTE_KEY = "og.private";
export type {
  PrivateInviteView,
  PrivateInvitesView,
  PrivateMessageView,
  PrivateRemote,
  PrivateSessionView,
} from "./private/remote";
