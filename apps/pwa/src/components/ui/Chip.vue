// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
// Status chip — colour pairs are AA-checked in every mode (contrast.test.ts).
// verified = green, private = violet (reserved), neutral, warning.
defineProps<{ variant?: "verified" | "private" | "neutral" | "warning" }>();
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-sub font-medium"
    :class="{
      'bg-ok text-ok-fg': variant === 'verified',
      'bg-pv text-pv-fg': variant === 'private',
      'bg-warn text-warn-fg': variant === 'warning',
      'bg-neutral text-neutral-fg': !variant || variant === 'neutral',
    }"
  >
    <slot />
  </span>
</template>
