// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  total: number;
  current: number;
}>();

const emit = defineEmits<{
  query: [q: string];
  prev: [];
  next: [];
  close: [];
}>();

const q = ref("");
let timer: ReturnType<typeof setTimeout>;

watch(q, (v) => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    // contract: q minLength 2 — shorter queries are not sent
    emit("query", v.trim().length >= 2 ? v.trim() : "");
  }, 300);
});
</script>

<template>
  <div class="flex items-center gap-2 border-b border-line px-6 py-2" data-testid="chat-search">
    <svg viewBox="0 0 24 24" class="size-4 shrink-0 text-muted" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
    <input
      v-model="q"
      class="w-full bg-transparent text-msg outline-none placeholder:text-muted"
      placeholder="search in chat…"
      data-testid="search-input"
    />
    <span v-if="total" class="text-meta text-muted" data-testid="search-count">
      {{ current + 1 }} of {{ total }}
    </span>
    <button class="p-1 text-muted disabled:opacity-40" aria-label="previous" :disabled="!total" @click="emit('prev')">
      <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2">
        <path d="m18 15-6-6-6 6" />
      </svg>
    </button>
    <button class="p-1 text-muted disabled:opacity-40" aria-label="next" :disabled="!total" @click="emit('next')">
      <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
    <button class="p-1 text-muted" aria-label="close search" @click="emit('close')">
      <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    </button>
  </div>
</template>
