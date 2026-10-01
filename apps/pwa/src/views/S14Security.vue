// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { useSessionStore, type DeviceSession } from "@openglass/core";

import ConfirmDialog from "../components/ConfirmDialog.vue";

const router = useRouter();
const session = useSessionStore();

const busy = ref(false);
const loadError = ref("");
const confirmTarget = ref<DeviceSession | null>(null);
const confirmRevokeAll = ref(false);

const others = computed(() => session.sessions.filter((s) => !s.current));

function fmtLastSeen(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "active now";
  if (s < 3600) return `last active ${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `last active ${Math.floor(s / 3600)}h ago`;
  return `last active ${Math.floor(s / 86400)}d ago`;
}

async function revoke() {
  if (!confirmTarget.value) return;
  const id = confirmTarget.value.id;
  confirmTarget.value = null;
  busy.value = true;
  try {
    await session.revokeSession(id);
  } catch {
    loadError.value = "could not revoke — retry";
  } finally {
    busy.value = false;
  }
}

async function revokeAll() {
  confirmRevokeAll.value = false;
  busy.value = true;
  try {
    await session.revokeOtherSessions();
  } catch {
    loadError.value = "could not revoke — retry";
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    await session.refreshSessions();
  } catch {
    loadError.value = "failed to load sessions";
  }
});
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
      <div class="text-name text-ink">Security</div>
    </div>

    <div v-if="loadError" class="px-6 py-2 text-meta text-danger" data-testid="load-error">
      {{ loadError }}
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="px-6 pb-1 pt-2 text-meta text-muted">sessions</div>
      <div
        v-for="s in session.sessions"
        :key="s.id"
        class="flex items-center gap-3 px-6 py-3"
        data-testid="session-row"
      >
        <div class="min-w-0 flex-1">
          <div class="truncate text-name text-ink">
            {{ s.deviceName }}
            <span v-if="s.current" class="ml-1 rounded-pill bg-soft px-2 py-0.5 text-micro text-muted">
              this device
            </span>
          </div>
          <div class="text-meta text-muted">{{ fmtLastSeen(s.lastSeenAt) }}</div>
        </div>
        <button
          v-if="!s.current"
          class="text-meta text-danger"
          :disabled="busy"
          :data-testid="`revoke-${s.id}`"
          @click="confirmTarget = s"
        >
          revoke
        </button>
      </div>
      <div v-if="!session.sessions.length && !loadError" class="px-6 py-8 text-center text-meta text-muted">
        loading…
      </div>

      <div class="mt-6 px-6">
        <button
          v-if="others.length"
          class="w-full py-3 text-left text-name text-danger"
          :disabled="busy"
          data-testid="revoke-all"
          @click="confirmRevokeAll = true"
        >
          revoke all other sessions
        </button>
      </div>
    </div>

    <ConfirmDialog
      v-if="confirmTarget"
      :title="`revoke ${confirmTarget.deviceName}?`"
      body="that device will be signed out immediately"
      confirm-label="revoke"
      @confirm="revoke"
      @cancel="confirmTarget = null"
    />
    <ConfirmDialog
      v-else-if="confirmRevokeAll"
      title="revoke all other sessions?"
      body="every other device will be signed out"
      confirm-label="revoke all"
      @confirm="revokeAll"
      @cancel="confirmRevokeAll = false"
    />
  </main>
</template>
