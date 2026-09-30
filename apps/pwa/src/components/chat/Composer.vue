// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { ref, watch } from "vue";

import type { LocalMessage } from "@openglass/core";

import type { StagedAttachment } from "./attachment";

const props = defineProps<{
  offline: boolean;
  replyTo: LocalMessage | null;
  editing: LocalMessage | null;
  staged: StagedAttachment | null;
  replyTargetName?: string;
}>();

const emit = defineEmits<{
  send: [text: string];
  cancel: []; // cancel whichever strip is open
  stage: [file: File];
}>();

const text = ref("");
const fileInput = ref<HTMLInputElement>();

watch(
  () => props.editing,
  (m) => {
    if (m) text.value = m.text ?? "";
  },
);

function submit() {
  const t = text.value.trim();
  if (!t && !props.staged?.attachmentId) return;
  emit("send", t);
  text.value = "";
}

function pickFile(f: File | undefined) {
  if (!f) return;
  emit("stage", f);
  if (fileInput.value) fileInput.value.value = "";
}

const placeholder = () =>
  props.editing ? "edit message…" : props.replyTo ? "reply…" : props.staged ? "caption…" : "message…";
</script>

<template>
  <div>
    <!-- strips: one at a time — reply / edit / staged attachment -->
    <div
      v-if="replyTo"
      class="mx-6 mb-2 flex items-center gap-3 border-l-2 border-accent bg-canvas px-3 py-2 rounded-input"
      data-testid="strip-reply"
    >
      <div class="min-w-0 flex-1">
        <div class="text-sub text-accent">{{ replyTargetName ?? "reply" }}</div>
        <div class="truncate text-msg text-body">{{ replyTo.text }}</div>
      </div>
      <button class="text-muted" aria-label="cancel reply" @click="emit('cancel')">✕</button>
    </div>

    <div
      v-else-if="editing"
      class="mx-6 mb-2 flex items-center gap-3 border-l-2 border-accent bg-canvas px-3 py-2 rounded-input"
      data-testid="strip-edit"
    >
      <div class="min-w-0 flex-1">
        <div class="text-sub text-accent">editing</div>
        <div class="truncate text-msg text-body">{{ editing.text }}</div>
      </div>
      <button class="text-muted" aria-label="cancel edit" @click="emit('cancel')">✕</button>
    </div>

    <div
      v-else-if="staged"
      class="mx-6 mb-2 flex items-center gap-3 border-l-2 bg-canvas px-3 py-2 rounded-input"
      :class="staged.error ? 'border-danger' : 'border-accent'"
      data-testid="strip-attachment"
    >
      <div class="min-w-0 flex-1">
        <div class="text-sub" :class="staged.error ? 'text-danger' : 'text-accent'">
          {{ staged.fileName }} · {{ Math.max(1, Math.round(staged.sizeBytes / 1024 / 1024)) }} mb
        </div>
        <div class="text-msg text-body">
          {{ staged.error ?? (staged.attachmentId ? "ready" : "uploading…") }}
        </div>
      </div>
      <button class="text-muted" aria-label="remove attachment" @click="emit('cancel')">✕</button>
    </div>

    <div class="flex items-end gap-2 px-6 pb-6" :class="offline ? 'opacity-40' : ''">
      <div class="flex min-h-11 flex-1 items-center gap-2 rounded-pill border border-line px-4">
        <button
          class="text-muted disabled:opacity-40"
          aria-label="attach"
          :disabled="offline || (!!staged && !staged.attachmentId && !staged.error)"
          @click="fileInput?.click()"
        >
          <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2">
            <path
              d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"
            />
          </svg>
        </button>
        <input
          ref="fileInput"
          type="file"
          class="hidden"
          data-testid="file-input"
          @change="pickFile(($event.target as HTMLInputElement).files?.[0])"
        />
        <input
          v-model="text"
          class="w-full bg-transparent text-msg outline-none placeholder:text-muted"
          :placeholder="offline ? 'offline…' : placeholder()"
          :disabled="offline"
          data-testid="composer-input"
          @keydown.enter="submit"
        />
      </div>
      <button
        class="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-bg disabled:opacity-40"
        aria-label="send"
        data-testid="send"
        :disabled="offline || (!!staged && !staged.attachmentId && !staged.error)"
        @click="submit"
      >
        <!-- edit mode → check icon; otherwise send arrow -->
        <svg v-if="editing" viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <svg v-else viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m5 12 7-7 7 7" />
          <path d="M12 19V5" />
        </svg>
      </button>
    </div>
  </div>
</template>
