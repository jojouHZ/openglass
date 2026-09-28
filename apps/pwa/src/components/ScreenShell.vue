<!-- Copyright (C) 2025 OpenGlass contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<!-- Auth/setup screen shell: centered column on the 8pt grid.
     Back slot shows a chevron when `back` is provided.
     (The kit's fake 9:41 status-bar is a device-frame artifact —
     a real PWA gets OS chrome for free, so we don't render one.) -->

<script setup lang="ts">
import { ChevronLeft } from "lucide-vue-next";

defineProps<{ back?: () => void }>();
</script>

<template>
  <main class="relative flex min-h-dvh flex-col items-center justify-center px-6">
    <button
      v-if="back"
      type="button"
      aria-label="back"
      class="absolute left-4 top-4 flex h-11 w-11 items-center justify-center text-ink"
      @click="back"
    >
      <ChevronLeft class="h-5 w-5" :stroke-width="1.25" />
    </button>
    <div class="flex w-[min(342px,100%)] flex-col gap-6">
      <slot />
    </div>
  </main>
</template>
