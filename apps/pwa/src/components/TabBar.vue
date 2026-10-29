// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { MessageCircle, Settings, Users } from "lucide-vue-next";

import { useContactsStore } from "@openglass/core";

// Root navigation (concept-07): Chats · Contacts · Settings. Rendered by the
// shell only on routes with `meta.nav` — never inside a chat or a sub-screen.
const route = useRoute();
const router = useRouter();
const contacts = useContactsStore();

// the badge must be right on a deep link too (e.g. straight to /settings)
onMounted(() => void contacts.refresh().catch(() => undefined));

const tabs = [
  { id: "chats", label: "Chats", to: "s4-chat-list", icon: MessageCircle },
  { id: "contacts", label: "Contacts", to: "s6-contact-search", icon: Users },
  { id: "settings", label: "Settings", to: "s13-settings", icon: Settings },
] as const;

const active = computed(() => (route.meta.tab as string | undefined) ?? "");
const badge = (id: string) => (id === "contacts" ? contacts.requestCount : 0);
</script>

<template>
  <nav
    class="grid grid-cols-3 border-t border-line bg-card pb-[env(safe-area-inset-bottom)]"
    aria-label="main"
    data-testid="tab-bar"
  >
    <button
      v-for="t in tabs"
      :key="t.id"
      type="button"
      class="relative flex h-14 flex-col items-center justify-center gap-0.5 text-sub transition-colors"
      :class="active === t.id ? 'text-primary font-semibold' : 'text-muted'"
      :aria-current="active === t.id ? 'page' : undefined"
      :data-testid="`tab-${t.id}`"
      @click="active !== t.id && router.push({ name: t.to })"
    >
      <span class="relative">
        <component :is="t.icon" class="size-5" :stroke-width="active === t.id ? 2 : 1.5" />
        <span
          v-if="badge(t.id)"
          class="absolute -right-2.5 -top-1.5 grid min-w-4 place-items-center rounded-full bg-burn px-1 text-micro font-semibold text-white"
          :data-testid="t.id === 'contacts' ? 'requests-badge' : `badge-${t.id}`"
          :aria-label="`${badge(t.id)} pending`"
        >{{ badge(t.id) }}</span>
      </span>
      {{ t.label }}
    </button>
  </nav>
</template>
