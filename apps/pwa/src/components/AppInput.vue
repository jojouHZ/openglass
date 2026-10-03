<!-- Copyright (C) 2025 OpenGlass contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<!-- Field: label + input + optional inline error.
     Kit: .field/.field-label/.input — r-input(8), 1px line border,
     accent on focus-visible. -->

<script setup lang="ts">
// Fragment root (label + error line): without inheritAttrs:false every
// attr (required, maxlength, autofocus, data-testid) is dropped with a
// Vue warn — bind them onto the real input instead.
defineOptions({ inheritAttrs: false });

defineProps<{
  label: string;
  placeholder?: string;
  type?: string;
  readonly?: boolean;
  error?: string | null;
  autocomplete?: string;
}>();

const model = defineModel<string>();
</script>

<template>
  <label class="flex flex-col gap-2">
    <span class="text-sender text-muted uppercase tracking-wide">{{ label }}</span>
    <input
      v-bind="$attrs"
      v-model="model"
      :type="type ?? 'text'"
      :placeholder="placeholder"
      :readonly="readonly"
      :autocomplete="autocomplete"
      class="h-11 w-full rounded-input border px-3 text-body outline-none transition-colors focus-visible:border-accent"
      :class="error ? 'border-danger' : 'border-line'"
    />
  </label>
  <p v-if="error" class="text-meta text-danger">{{ error }}</p>
</template>
