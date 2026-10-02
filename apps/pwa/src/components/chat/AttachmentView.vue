// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

import type { Attachment } from "@openglass/core";
import { api } from "@openglass/core";

const props = defineProps<{ att: Attachment }>();

const objectUrl = ref<string | null>(null);
const failed = ref(false);

const loading = ref(false);

async function load() {
  loading.value = true;
  failed.value = false;
  try {
    const blob = await api().messages.downloadAttachment(props.att.id);
    objectUrl.value = URL.createObjectURL(blob);
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

onBeforeUnmount(() => {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value);
});

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} b`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kb`;
  return `${(bytes / 1024 / 1024).toFixed(1)} mb`;
}

function download() {
  if (failed.value) {
    void load(); // retry
    return;
  }
  if (!objectUrl.value) return;
  const a = document.createElement("a");
  a.href = objectUrl.value;
  a.download = props.att.fileName ?? "file";
  a.click();
}
</script>

<template>
  <img
    v-if="att.kind === 'photo' && objectUrl"
    :src="objectUrl"
    :alt="att.fileName ?? 'photo'"
    class="max-h-64 max-w-full cursor-pointer rounded-input object-cover"
    data-testid="att-photo"
    @click="download"
  />
  <button
    v-else
    class="flex items-center gap-2 rounded-input px-2 py-1.5 text-left"
    :class="failed ? 'text-danger opacity-70' : 'hover:bg-canvas/40'"
    :disabled="!objectUrl && !failed"
    data-testid="att-file"
    @click="download"
  >
    <svg viewBox="0 0 24 24" class="size-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
    <span class="min-w-0">
      <span class="block truncate text-sub">{{ failed ? "download failed — tap to retry" : (att.fileName ?? "file") }}</span>
      <span class="block text-meta opacity-70">{{ fmtSize(att.sizeBytes) }}</span>
    </span>
  </button>
</template>
