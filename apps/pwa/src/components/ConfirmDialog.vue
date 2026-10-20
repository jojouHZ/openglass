// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import {
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogRoot,
  AlertDialogTitle,
} from "reka-ui";

// Destructive confirms on Reka's AlertDialog: focus trap, Esc cancels,
// ARIA alertdialog semantics. Outside clicks do not dismiss (a stray tap
// must not silently cancel a destructive flow).
defineProps<{ title: string; body?: string; confirmLabel?: string; busy?: boolean }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <AlertDialogRoot :open="true" @update:open="(v) => !v && emit('cancel')">
    <AlertDialogOverlay class="fixed inset-0 z-50 bg-ink/40" />
    <div class="pointer-events-none fixed inset-0 z-50 grid place-items-center px-6">
      <AlertDialogContent
        class="pointer-events-auto flex w-[min(342px,100%)] flex-col gap-4 rounded-card bg-bg p-6 shadow-pop outline-none"
        data-testid="confirm-dialog"
      >
        <AlertDialogTitle class="text-name text-ink">{{ title }}</AlertDialogTitle>
        <AlertDialogDescription v-if="body" class="text-msg text-muted">{{ body }}</AlertDialogDescription>
        <AlertDialogDescription v-else class="sr-only">{{ title }}</AlertDialogDescription>
        <div class="flex gap-3">
          <button
            type="button"
            class="h-11 flex-1 rounded-input border border-line text-msg text-ink focus-visible:ring-2 focus-visible:ring-ring"
            :disabled="busy"
            @click="emit('cancel')"
          >
            cancel
          </button>
          <button
            type="button"
            class="h-11 flex-1 rounded-input bg-ink text-msg text-bg focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            :disabled="busy"
            data-testid="confirm-action"
            @click="emit('confirm')"
          >
            {{ confirmLabel ?? "confirm" }}
          </button>
        </div>
      </AlertDialogContent>
    </div>
  </AlertDialogRoot>
</template>
