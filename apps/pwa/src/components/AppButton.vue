<!-- Copyright (C) 2025 OpenGlass contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<!-- Primary button — kit .btn-primary: ink fill, white text, r-input. -->

<script setup lang="ts">
defineProps<{ disabled?: boolean; loading?: boolean }>();
</script>

<template>
  <button
    type="submit"
    :disabled="disabled || loading"
    class="h-11 w-full rounded-input bg-ink text-body text-bg transition-opacity disabled:opacity-40"
  >
    <slot v-if="!loading" />
    <span v-else>…</span>
  </button>
</template>
