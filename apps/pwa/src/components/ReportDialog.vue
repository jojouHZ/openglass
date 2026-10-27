// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { ApiRequestError, useContactsStore } from "@openglass/core";

const props = defineProps<{ userId: string; name: string }>();
const emit = defineEmits<{ close: [] }>();

const MAX = 1024;
const contacts = useContactsStore();

const reason = ref("");
const busy = ref(false);
const done = ref(false);
const error = ref("");

// characters, not UTF-16 units — matches the server's rune count
const length = computed(() => [...reason.value.trim()].length);
const valid = computed(() => length.value >= 1 && length.value <= MAX);

async function submit() {
  if (!valid.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await contacts.report(props.userId, reason.value.trim());
    done.value = true;
  } catch (e) {
    error.value =
      e instanceof ApiRequestError && e.status === 429
        ? "too many reports — please try again in a little while"
        : e instanceof ApiRequestError && e.status === 409
          ? "you already have the maximum number of open reports — please wait until the owner has reviewed them"
          : "could not send the report — please try again";
  } finally {
    busy.value = false;
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}
onMounted(() => document.addEventListener("keydown", onKey));
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
</script>

<template>
  <div
    class="fixed inset-0 z-50 grid place-items-center bg-ink/40 px-6"
    data-testid="report-dialog"
    role="dialog"
    aria-modal="true"
    @click.self="emit('close')"
  >
    <div class="flex w-[min(342px,100%)] flex-col gap-4 rounded-input bg-bg p-6">
      <template v-if="!done">
        <div class="text-name text-ink">report {{ name }}</div>
        <div class="text-meta text-muted">
          The instance owner will read this and can see that it came from you.
          {{ name }} is not told, and nothing changes automatically.
        </div>
        <textarea
          v-model="reason"
          rows="4"
          class="w-full resize-none rounded-input border border-line bg-bg p-3 text-msg text-ink"
          placeholder="what happened?"
          aria-label="reason for the report"
          data-testid="report-reason"
        />
        <div
          class="text-right text-meta"
          :class="length > MAX ? 'text-danger' : 'text-muted'"
          data-testid="report-counter"
        >
          {{ length }} / {{ MAX }}
        </div>
        <div v-if="error" class="text-meta text-danger" data-testid="report-error">{{ error }}</div>
        <div class="flex gap-3">
          <button
            type="button"
            class="h-11 flex-1 rounded-input border border-line text-msg text-ink"
            data-testid="report-cancel"
            @click="emit('close')"
          >
            cancel
          </button>
          <button
            type="button"
            class="h-11 flex-1 rounded-input bg-danger text-msg text-bg disabled:opacity-40"
            :disabled="!valid || busy"
            data-testid="report-submit"
            @click="submit"
          >
            send report
          </button>
        </div>
      </template>
      <template v-else>
        <div class="text-name text-ink">report received</div>
        <div class="text-msg text-muted" data-testid="report-done">
          The instance owner can read it. You will not be told the outcome.
        </div>
        <button
          type="button"
          class="h-11 w-full rounded-input border border-line text-msg text-ink"
          data-testid="report-close"
          @click="emit('close')"
        >
          close
        </button>
      </template>
    </div>
  </div>
</template>
