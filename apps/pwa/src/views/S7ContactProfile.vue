// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ChevronLeft } from "lucide-vue-next";

import type { Relationship, User } from "@openglass/core";
import { api, ApiRequestError, useContactsStore } from "@openglass/core";

import AppButton from "../components/AppButton.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";

const route = useRoute();
const router = useRouter();
const contacts = useContactsStore();

const privateModule = import.meta.env.VITE_PRIVATE_MODULE === "1";

const userId = computed(() => String(route.params.userId));
const user = ref<User | null>(null);
const relationship = ref<Relationship>("none");
const loading = ref(true);
const notFound = ref(false);
const busy = ref(false);
const errorMsg = ref("");
const confirmRemove = ref(false);

async function load() {
  loading.value = true;
  errorMsg.value = "";
  try {
    const r = await api().users.get(userId.value);
    user.value = r.user;
    relationship.value = r.relationship;
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) notFound.value = true;
    else errorMsg.value = "failed to load profile";
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const badge = computed(() => {
  switch (relationship.value) {
    case "contact_incoming": return "added you";
    case "contact_outgoing": return "in your contacts";
    case "contact_mutual": return "mutual contact";
    case "self": return "this is you";
    default: return null;
  }
});

async function add() {
  if (busy.value) return;
  busy.value = true;
  errorMsg.value = "";
  try {
    await contacts.add(userId.value);
    await load(); // refetch — relationship may now be outgoing or mutual
  } catch {
    errorMsg.value = "failed to add contact";
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (busy.value) return;
  busy.value = true;
  errorMsg.value = "";
  try {
    await contacts.remove(userId.value);
    confirmRemove.value = false;
    await load(); // their edge may remain — refetch tells the truth
  } catch {
    errorMsg.value = "failed to remove contact";
  } finally {
    busy.value = false;
  }
}

/** pwa-dev only — the button doesn't render in pwa-mvp. */
async function privateSession() {
  if (busy.value) return;
  busy.value = true;
  errorMsg.value = "";
  try {
    const { chat } = await api().chats.openDirect(userId.value);
    router.push({ name: "s10-private-invite", params: { chatId: chat.id } });
  } catch {
    errorMsg.value = "failed to open chat";
  } finally {
    busy.value = false;
  }
}

async function message() {
  if (busy.value) return;
  busy.value = true;
  errorMsg.value = "";
  try {
    const { chat } = await api().chats.openDirect(userId.value);
    router.push({ name: "s5-chat-view", params: { chatId: chat.id } });
  } catch (e) {
    // server enforces mutual contacts — surface it, never mask
    errorMsg.value =
      e instanceof ApiRequestError && e.status === 403
        ? "add each other first — direct chats need mutual contacts"
        : "failed to open chat";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="flex min-h-dvh flex-col">
    <div class="flex items-center px-6 pb-4 pt-8">
      <button
        class="grid size-10 place-items-center text-ink"
        aria-label="back"
        @click="router.back()"
      >
        <ChevronLeft class="size-5" :stroke-width="1.25" />
      </button>
    </div>

    <div v-if="loading" class="grid flex-1 place-items-center text-meta text-muted">
      loading…
    </div>

    <div
      v-else-if="notFound"
      class="grid flex-1 place-items-center px-6 text-center"
      data-testid="not-found"
    >
      <div class="flex flex-col items-center gap-3">
        <div class="text-body text-ink">user not found</div>
        <div class="text-meta text-muted">the profile may have been removed</div>
      </div>
    </div>

    <div v-else-if="user" class="flex flex-col items-center gap-6 px-6 pt-4">
      <span
        class="grid size-24 place-items-center rounded-full bg-bubble-in text-header text-muted"
        data-testid="avatar"
      >
        {{ user.displayName.slice(0, 1) }}
      </span>
      <div class="flex flex-col items-center gap-1 text-center">
        <div class="text-header text-ink" data-testid="display-name">{{ user.displayName }}</div>
        <div class="text-msg text-muted" data-testid="tag">{{ user.tag }}</div>
        <div v-if="badge" class="mt-1 rounded-pill bg-soft px-3 py-1 text-meta text-muted" data-testid="badge">
          {{ badge }}
        </div>
      </div>

      <div class="flex w-[min(342px,100%)] flex-col gap-3">
        <AppButton
          v-if="relationship === 'contact_mutual'"
          :loading="busy"
          data-testid="action-message"
          @click="message"
        >
          message
        </AppButton>
        <AppButton
          v-else-if="relationship === 'contact_incoming'"
          :loading="busy"
          data-testid="action-add-back"
          @click="add"
        >
          add back
        </AppButton>
        <AppButton
          v-else-if="relationship === 'none'"
          :loading="busy"
          data-testid="action-add"
          @click="add"
        >
          add contact
        </AppButton>

        <button
          v-if="privateModule && relationship === 'contact_mutual'"
          class="h-11 w-full rounded-input border border-line text-msg text-ink"
          data-testid="action-private"
          @click="privateSession"
        >
          private session
        </button>

        <button
          v-if="relationship === 'contact_outgoing' || relationship === 'contact_mutual'"
          class="h-11 w-full rounded-input text-msg text-danger"
          data-testid="action-remove"
          @click="confirmRemove = true"
        >
          remove contact
        </button>

        <div v-if="errorMsg" class="text-center text-meta text-danger" data-testid="error">
          {{ errorMsg }}
        </div>
      </div>
    </div>

    <ConfirmDialog
      v-if="confirmRemove && user"
      title="remove contact?"
      :body="`${user.displayName} will stay able to see you if they added you — this only removes your side.`"
      confirm-label="remove"
      :busy="busy"
      @confirm="remove"
      @cancel="confirmRemove = false"
    />
  </main>
</template>
