<!-- Copyright (C) 2025 OpenGlass contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<!-- 6-cell OTP input: auto-advance, backspace to previous, full paste. -->

<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{ length?: number; disabled?: boolean }>();
const emit = defineEmits<{ complete: [code: string] }>();
const model = defineModel<string>({ default: "" });

const len = props.length ?? 6;
const cells = ref<string[]>(Array.from({ length: len }, () => ""));
const inputs = ref<HTMLInputElement[]>([]);

// External reset (e.g. after a failed verify) must clear the cells —
// defineModel syncs parent←cells, so mirror parent→cells here.
watch(model, (v) => {
  if (v === "") cells.value = Array.from({ length: len }, () => "");
});

function sync() {
  model.value = cells.value.join("");
  if (model.value.length === len) emit("complete", model.value);
}

function onInput(i: number, e: Event) {
  const v = (e.target as HTMLInputElement).value.replace(/\D/g, "");
  if (v.length > 1) {
    // pasted multiple digits
    v.slice(0, len - i).split("").forEach((ch, k) => (cells.value[i + k] = ch));
    inputs.value[Math.min(i + v.length, len - 1)]?.focus();
    sync();
    return;
  }
  cells.value[i] = v;
  if (v && i < len - 1) inputs.value[i + 1]?.focus();
  sync();
}

function onKeydown(i: number, e: KeyboardEvent) {
  if (e.key === "Backspace" && !cells.value[i] && i > 0) {
    cells.value[i - 1] = "";
    inputs.value[i - 1]?.focus();
    sync();
  }
}
</script>

<template>
  <div class="flex justify-center gap-2" :class="disabled && 'opacity-50 pointer-events-none'">
    <input
      v-for="(_, i) in len"
      :key="i"
      :ref="(el) => el && (inputs[i] = el as HTMLInputElement)"
      v-model="cells[i]"
      type="text"
      inputmode="numeric"
      maxlength="1"
      class="h-12 w-10 rounded-input border border-line text-center text-header outline-none focus-visible:border-accent"
      @input="onInput(i, $event)"
      @keydown="onKeydown(i, $event)"
    />
  </div>
</template>
