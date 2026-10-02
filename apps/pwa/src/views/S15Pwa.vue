// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";

import { useChatsStore } from "@openglass/core";

import AppButton from "../components/AppButton.vue";
import { useInstallPrompt } from "../pwa/install";

const router = useRouter();
const chats = useChatsStore();
const { installed, canPrompt, needsManual, promptInstall } = useInstallPrompt();

const connState = computed(() => chats.connState);

async function install() {
  const outcome = await promptInstall();
  if (outcome === "dismissed") router.push({ name: "s13-settings" });
}
</script>

<template>
  <main class="flex h-dvh flex-col overflow-hidden">
    <div class="flex items-center gap-3 px-6 pb-4 pt-8">
      <button
        class="grid size-10 shrink-0 place-items-center text-ink"
        aria-label="back"
        @click="router.push({ name: 's13-settings' })"
      >
        <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.25">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <div class="text-name text-ink">App</div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-6">
      <div class="flex flex-col gap-4 pb-8 pt-2">
        <!-- install -->
        <section class="rounded-card border border-line px-4 py-4" data-testid="card-install">
          <div class="text-msg text-ink">install OpenGlass</div>
          <p class="mt-1 text-sub text-muted">
            add to home screen for a native feel — standalone window, no browser chrome
          </p>
          <div v-if="installed" class="mt-3 text-sub text-accent" data-testid="install-done">
            installed — launch from your home screen
          </div>
          <div v-else-if="needsManual()" class="mt-3 text-sub text-muted" data-testid="install-ios">
            in Safari: Share → <b>Add to Home Screen</b>
          </div>
          <div v-else-if="canPrompt()" class="mt-3">
            <AppButton data-testid="install-prompt" @click="install">install</AppButton>
          </div>
          <p v-else class="mt-3 text-sub text-muted" data-testid="install-unavailable">
            your browser will offer install once the app is ready — or check the browser menu
          </p>
        </section>

        <!-- offline -->
        <section class="rounded-card border border-line px-4 py-4" data-testid="card-offline">
          <div class="text-msg text-ink">offline mode</div>
          <p class="mt-1 text-sub text-muted">
            the app shell and chat list work offline on installed builds;
            sending waits until you're back online
          </p>
          <div class="mt-3 text-sub" :class="connState === 'online' ? 'text-accent' : 'text-muted'"
            data-testid="offline-state">
            {{ connState === "online" ? "online now" : connState === "connecting" ? "reconnecting…" : "offline now" }}
          </div>
        </section>
      </div>
    </div>
  </main>
</template>
