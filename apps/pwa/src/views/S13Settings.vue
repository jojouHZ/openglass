// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";

import { useSessionStore } from "@openglass/core";

import AppButton from "../components/AppButton.vue";
import AppInput from "../components/AppInput.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";

const router = useRouter();
const session = useSessionStore();

const user = computed(() => session.user);
const editing = ref(false);
const draft = ref("");
const busy = ref(false);
const errorMsg = ref("");
const confirmSignOut = ref(false);

async function saveName() {
  const name = draft.value.trim();
  if (!name || name === user.value?.displayName) {
    editing.value = false;
    return;
  }
  busy.value = true;
  errorMsg.value = "";
  try {
    await session.updateProfile(name);
    editing.value = false;
  } catch {
    errorMsg.value = "could not save — try a different name";
  } finally {
    busy.value = false;
  }
}

async function signOut() {
  confirmSignOut.value = false;
  await session.logout();
  router.push({ name: "s1-invite" });
}
</script>

<template>
  <main class="flex h-dvh flex-col overflow-hidden">
    <div class="flex items-center gap-3 px-6 pb-4 pt-8">
      <button
        class="grid size-10 shrink-0 place-items-center text-ink"
        aria-label="back"
        @click="router.push({ name: 's4-chat-list' })"
      >
        <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.25">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <div class="text-name text-ink">Settings</div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="flex flex-col items-center gap-2 px-6 pt-2 text-center">
        <span
          class="grid size-20 place-items-center rounded-full bg-bubble-in text-header text-muted"
          data-testid="avatar"
        >
          {{ user?.displayName.slice(0, 1) }}
        </span>
        <div class="text-header text-ink" data-testid="display-name">{{ user?.displayName }}</div>
        <div class="text-msg text-muted" data-testid="tag">{{ user?.tag }}</div>
        <div v-if="session.email" class="text-meta text-muted" data-testid="email">{{ session.email }}</div>
      </div>

      <div class="mt-6 px-6 pb-1 text-meta text-muted">account</div>

      <div v-if="!editing" class="px-6">
        <button
          class="w-full py-3 text-left text-name text-ink"
          data-testid="edit-profile"
          @click="((editing = true), (draft = user?.displayName ?? ''))"
        >
          my profile — edit name
        </button>
      </div>
      <div v-else class="px-6 py-2" data-testid="profile-editor">
        <AppInput v-model="draft" label="display name" placeholder="display name" />
        <div class="mt-2 flex items-center gap-3">
          <AppButton :loading="busy" data-testid="name-save" @click="saveName">save</AppButton>
          <button class="text-muted" @click="editing = false">cancel</button>
        </div>
        <div v-if="errorMsg" class="mt-2 text-meta text-danger" data-testid="name-error">{{ errorMsg }}</div>
      </div>

      <div class="mt-4 px-6 pb-1 text-meta text-muted">preferences</div>
      <button
        class="w-full px-6 py-3 text-left text-name text-ink"
        data-testid="security-link"
        @click="router.push({ name: 's14-security' })"
      >
        security & sessions
      </button>

      <div class="mt-6 px-6">
        <button
          class="w-full py-3 text-left text-name text-danger"
          data-testid="sign-out"
          @click="confirmSignOut = true"
        >
          sign out
        </button>
      </div>
    </div>

    <ConfirmDialog
      v-if="confirmSignOut"
      title="sign out?"
      body="your session on this device will be closed"
      confirm-label="sign out"
      data-testid="confirm-signout"
      @confirm="signOut"
      @cancel="confirmSignOut = false"
    />
  </main>
</template>
