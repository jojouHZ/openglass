// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { Check, ChevronLeft } from "lucide-vue-next";

import { ApiRequestError, useChatsStore, useContactsStore } from "@openglass/core";

import AppButton from "../components/AppButton.vue";
import AppInput from "../components/AppInput.vue";
import UserRow from "../components/UserRow.vue";

const router = useRouter();
const chats = useChatsStore();
const contacts = useContactsStore();

const title = ref("");
const selected = ref(new Set<string>());
const busy = ref(false);
const errorMsg = ref("");

// contacts-only picker (B3 rule: outgoing edge suffices — the server
// re-checks anyway; the picker just never offers strangers)
const roster = computed(() => contacts.list);
const canCreate = computed(() => title.value.trim().length > 0 && selected.value.size > 0);

onMounted(() => void contacts.refresh().catch(() => undefined));

function toggle(id: string) {
  if (selected.value.has(id)) selected.value.delete(id);
  else selected.value.add(id);
}

async function create() {
  if (!canCreate.value || busy.value) return;
  busy.value = true;
  errorMsg.value = "";
  try {
    const chat = await chats.createGroup(title.value.trim(), [...selected.value]);
    router.push({ name: "s5-chat-view", params: { chatId: chat.id } });
  } catch (e) {
    errorMsg.value =
      e instanceof ApiRequestError && e.status === 403
        ? "only your contacts can be added"
        : "failed to create group";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="flex h-dvh flex-col overflow-hidden">
    <div class="flex items-center gap-3 px-6 pb-4 pt-8">
      <button
        class="grid size-10 shrink-0 place-items-center text-ink"
        aria-label="back"
        @click="router.back()"
      >
        <ChevronLeft class="size-5" :stroke-width="1.25" />
      </button>
      <h1 class="text-header text-ink">New group</h1>
    </div>

    <div class="px-6 pb-4">
      <AppInput
        v-model="title"
        label="Group name"
        placeholder="ops room"
        :error="title.length > 128 ? 'max 128 chars' : null"
      />
    </div>

    <div class="px-6 pb-1 text-meta text-muted" data-testid="member-count">
      members · {{ selected.size }} selected
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <UserRow
        v-for="c in roster"
        :key="c.user.id"
        :user="c.user"
        data-testid="member-row"
        @open="toggle(c.user.id)"
      >
        <span
          class="grid size-6 place-items-center rounded-full border"
          :class="selected.has(c.user.id) ? 'border-ink bg-ink text-bg' : 'border-line text-transparent'"
          data-testid="member-check"
        >
          <Check class="size-3.5" :stroke-width="2.5" />
        </span>
      </UserRow>

      <div
        v-if="!roster.length && contacts.loaded"
        class="grid h-full place-items-center px-6 text-center"
        data-testid="empty"
      >
        <div class="flex flex-col items-center gap-3">
          <div class="text-body text-ink">no contacts yet</div>
          <div class="text-meta text-muted">find people first — groups start from contacts</div>
          <button
            class="mt-1 h-11 rounded-pill bg-ink px-6 text-msg text-bg"
            @click="router.push({ name: 's6-contact-search' })"
          >
            find contacts
          </button>
        </div>
      </div>
    </div>

    <div class="px-6 pb-8 pt-4">
      <div v-if="errorMsg" class="pb-2 text-center text-meta text-danger" data-testid="error">
        {{ errorMsg }}
      </div>
      <AppButton :disabled="!canCreate" :loading="busy" data-testid="create" @click="create">
        Create group
      </AppButton>
    </div>
  </main>
</template>
