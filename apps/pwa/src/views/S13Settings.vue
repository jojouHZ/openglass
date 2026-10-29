// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { computed, ref } from "vue";
import { ChevronRight, Download, LogOut, Pencil, Shield } from "lucide-vue-next";
import { useRouter } from "vue-router";

import { useSessionStore } from "@openglass/core";

import AppButton from "../components/AppButton.vue";
import AppInput from "../components/AppInput.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import Avatar from "../components/ui/Avatar.vue";
import Chip from "../components/ui/Chip.vue";
import { useThemeStore, type ThemePref } from "../stores/theme";

const router = useRouter();
const session = useSessionStore();
const theme = useThemeStore();

const THEMES: Array<{ value: ThemePref; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const user = computed(() => session.user);
const editing = ref(false);
const draft = ref("");
const busy = ref(false);
const errorMsg = ref("");
const confirmSignOut = ref(false);
const host = location.host;

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
  // local teardown is guaranteed by logout()'s finally — navigate
  // even when the server-side revoke call fails
  await session.logout().catch(() => undefined);
  router.push({ name: "s1-invite" });
}
</script>

<template>
  <main class="flex h-full flex-col overflow-hidden">
    <div class="px-6 pb-3 pt-8">
      <h1 class="text-header text-ink">Settings</h1>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
      <div class="flex items-center gap-4 rounded-card border border-line bg-card p-4">
        <span data-testid="avatar">
          <Avatar :name="user?.displayName ?? '?'" :tag="user?.tag" size="lg" />
        </span>
        <div class="min-w-0 flex-1">
          <div class="truncate text-name font-semibold text-ink" data-testid="display-name">{{ user?.displayName }}</div>
          <div class="truncate text-meta text-muted" data-testid="tag">{{ user?.tag }}</div>
          <div v-if="session.email" class="truncate text-meta text-muted" data-testid="email">{{ session.email }}</div>
          <Chip class="mt-1.5">tag can't change</Chip>
        </div>
      </div>

      <div class="px-1 pb-1 pt-5 text-sub font-semibold uppercase tracking-wide text-muted">account</div>
      <div v-if="!editing">
        <button
          class="flex w-full items-center gap-3 py-3 text-left text-name text-ink"
          data-testid="edit-profile"
          @click="((editing = true), (draft = user?.displayName ?? ''))"
        >
          <span class="grid size-9 place-items-center rounded-input bg-soft text-primary"><Pencil class="size-4" :stroke-width="1.75" /></span>
          <span class="flex-1">edit display name</span>
          <ChevronRight class="size-4 text-muted" :stroke-width="1.75" />
        </button>
      </div>
      <div v-else class="py-2" data-testid="profile-editor">
        <AppInput v-model="draft" label="display name" placeholder="display name" />
        <div class="mt-2 flex items-center gap-3">
          <AppButton :loading="busy" data-testid="name-save" @click="saveName">save</AppButton>
          <button class="text-muted" @click="editing = false">cancel</button>
        </div>
        <div v-if="errorMsg" class="mt-2 text-meta text-danger" data-testid="name-error">{{ errorMsg }}</div>
      </div>

      <div class="px-1 pb-1 pt-5 text-sub font-semibold uppercase tracking-wide text-muted">appearance</div>
      <div data-testid="appearance">
        <div class="sr-only" id="appearance-label">appearance</div>
        <div
          class="grid grid-cols-3 gap-1 rounded-input bg-soft p-1"
          role="radiogroup"
          aria-labelledby="appearance-label"
        >
          <button
            v-for="t in THEMES"
            :key="t.value"
            type="button"
            role="radio"
            :aria-checked="theme.pref === t.value"
            class="h-9 rounded-input text-meta transition-colors"
            :class="theme.pref === t.value ? 'bg-card font-semibold text-ink shadow-pop' : 'text-muted'"
            :data-testid="`theme-${t.value}`"
            @click="theme.set(t.value)"
          >
            {{ t.label }}
          </button>
        </div>
      </div>

      <div class="px-1 pb-1 pt-5 text-sub font-semibold uppercase tracking-wide text-muted">security</div>
      <button
        class="flex w-full items-center gap-3 border-b border-line py-3 text-left text-name text-ink"
        data-testid="security-link"
        @click="router.push({ name: 's14-security' })"
      >
        <span class="grid size-9 place-items-center rounded-input bg-soft text-primary"><Shield class="size-4" :stroke-width="1.75" /></span>
        <span class="flex-1">security & sessions</span>
        <ChevronRight class="size-4 text-muted" :stroke-width="1.75" />
      </button>
      <button
        class="flex w-full items-center gap-3 border-b border-line py-3 text-left text-name text-ink"
        data-testid="app-link"
        @click="router.push({ name: 's15-pwa' })"
      >
        <span class="grid size-9 place-items-center rounded-input bg-soft text-primary"><Download class="size-4" :stroke-width="1.75" /></span>
        <span class="flex-1">app — install & offline</span>
        <ChevronRight class="size-4 text-muted" :stroke-width="1.75" />
      </button>
      <button
        class="flex w-full items-center gap-3 border-b border-line py-3 text-left text-name text-danger"
        data-testid="sign-out"
        @click="confirmSignOut = true"
      >
        <span class="grid size-9 place-items-center rounded-input bg-soft"><LogOut class="size-4" :stroke-width="1.75" /></span>
        <span class="flex-1">sign out</span>
      </button>

      <div class="px-1 pb-1 pt-5 text-sub font-semibold uppercase tracking-wide text-muted">about</div>
      <div class="flex items-center justify-between py-3 text-name text-ink" data-testid="instance">
        <span>instance</span>
        <span class="text-meta text-muted">{{ host }}</span>
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
