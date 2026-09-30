// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";

defineProps<{ title: string; body?: string; confirmLabel?: string; busy?: boolean }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();

// keyboard: Esc cancels — destructive confirms must be escapable
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") emit("cancel");
}
onMounted(() => document.addEventListener("keydown", onKey));
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
</script>

<template>
  <div
    class="fixed inset-0 z-50 grid place-items-center bg-ink/40 px-6"
    data-testid="confirm-dialog"
    role="dialog"
    aria-modal="true"
    @click.self="emit('cancel')"
  >
    <div class="flex w-[min(342px,100%)] flex-col gap-4 rounded-input bg-bg p-6">
      <div class="text-name text-ink">{{ title }}</div>
      <div v-if="body" class="text-msg text-muted">{{ body }}</div>
      <div class="flex gap-3">
        <button
          type="button"
          class="h-11 flex-1 rounded-input border border-line text-msg text-ink"
          :disabled="busy"
          @click="emit('cancel')"
        >
          cancel
        </button>
        <button
          type="button"
          class="h-11 flex-1 rounded-input bg-ink text-msg text-bg disabled:opacity-40"
          :disabled="busy"
          data-testid="confirm-action"
          @click="emit('confirm')"
        >
          {{ confirmLabel ?? "confirm" }}
        </button>
      </div>
    </div>
  </div>
</template>
