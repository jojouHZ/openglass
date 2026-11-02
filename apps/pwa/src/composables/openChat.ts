// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useRouter } from "vue-router";

import { api } from "@openglass/core";

/**
 * Tapping a person goes straight to the conversation with them. Only mutual
 * contacts can have a direct chat (the server enforces it), so anyone else —
 * or a failed open — lands on the profile, where the missing step (send or
 * accept a request) is offered.
 */
export function useOpenChat() {
  const router = useRouter();

  const profile = (userId: string) =>
    router.push({ name: "s7-contact-profile", params: { userId } });

  async function chat(userId: string) {
    try {
      const { chat } = await api().chats.openDirect(userId);
      await router.push({ name: "s5-chat-view", params: { chatId: chat.id } });
    } catch {
      await profile(userId);
    }
  }

  return { chat, profile };
}
