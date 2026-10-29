// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import type { User } from "@openglass/core";

import Avatar from "./ui/Avatar.vue";

defineProps<{ user: User; subtitle?: string }>();
const emit = defineEmits<{ open: [] }>();
</script>

<template>
  <button
    class="flex w-full items-center gap-3 px-6 py-3 text-left hover:bg-canvas"
    data-testid="user-row"
    @click="emit('open')"
  >
    <Avatar :name="user.displayName" :tag="user.tag" />
    <span class="min-w-0 flex-1">
      <span class="block truncate text-name font-semibold text-ink" data-testid="user-name">
        {{ user.displayName }}
      </span>
      <span class="block truncate text-msg text-muted" data-testid="user-tag">
        {{ subtitle ?? user.tag }}
      </span>
    </span>
    <span class="shrink-0" @click.stop>
      <slot />
    </span>
  </button>
</template>
