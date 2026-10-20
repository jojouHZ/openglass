<!-- Copyright (C) 2025 OpenGlass contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { DialogContent, DialogDescription, DialogOverlay, DialogRoot, DialogTitle } from "reka-ui";

// Bottom sheet on mobile, centered modal from sm up. Built on Reka's
// Dialog: focus trap, Esc, ARIA and scroll-lock come from the primitive.
// Rendered inline (no portal) so ancestors can query it in tests.
defineOptions({ inheritAttrs: false });
defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogOverlay class="fixed inset-0 z-50 bg-ink/30" />
    <div class="pointer-events-none fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <DialogContent
        v-bind="$attrs"
        class="pointer-events-auto max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-card bg-bg p-6 pb-8 shadow-sheet outline-none sm:rounded-card"
      >
        <DialogTitle class="sr-only">{{ title }}</DialogTitle>
        <DialogDescription class="sr-only">{{ title }}</DialogDescription>
        <slot />
      </DialogContent>
    </div>
  </DialogRoot>
</template>
