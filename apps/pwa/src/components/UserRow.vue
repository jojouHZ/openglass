// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import type { User } from "@openglass/core";

defineProps<{ user: User }>();
const emit = defineEmits<{ open: [] }>();
</script>

<template>
  <button
    class="flex w-full items-center gap-3 px-6 py-3 text-left hover:bg-canvas"
    data-testid="user-row"
    @click="emit('open')"
  >
    <span class="grid size-[52px] shrink-0 place-items-center rounded-full bg-bubble-in text-name text-muted">
      {{ user.displayName.slice(0, 1) }}
    </span>
    <span class="min-w-0 flex-1">
      <span class="block truncate text-name text-ink" data-testid="user-name">
        {{ user.displayName }}
      </span>
      <span class="block truncate text-msg text-muted" data-testid="user-tag">
        {{ user.tag }}
      </span>
    </span>
    <span class="shrink-0" @click.stop>
      <slot />
    </span>
  </button>
</template>
