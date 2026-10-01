// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import type { LocalMessage } from "@openglass/core";

// Message context menu — s5a. Reactions are NOT in the API contract,
// so the kit's react-bar is intentionally omitted (no invented fields).

const props = defineProps<{
  message: LocalMessage;
  own: boolean;
  /** group pinMessages right / owner — server still enforces */
  canPin: boolean;
  /** own message, or deleteMessages right / owner in a group */
  canDelete: boolean;
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  reply: [];
  copy: [];
  edit: [];
  pin: [];
  delete: [];
  close: [];
}>();

const act = (fn: () => void) => () => {
  fn();
  emit("close");
};
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 bg-ink/30"
      data-testid="menu-scrim"
      @click="emit('close')"
      @contextmenu.prevent="emit('close')"
    >
      <div
        class="absolute w-44 rounded-card border border-line bg-bg py-2 shadow-lg"
        :style="{ left: Math.min(x, 200) + 'px', top: Math.min(y, 320) + 'px' }"
        data-testid="message-menu"
        @click.stop
      >
        <button class="menu-item" data-testid="mi-reply" @click="act(() => emit('reply'))()">
          reply
        </button>
        <button class="menu-item" data-testid="mi-copy" @click="act(() => emit('copy'))()">
          copy
        </button>
        <button
          v-if="own"
          class="menu-item"
          data-testid="mi-edit"
          @click="act(() => emit('edit'))()"
        >
          edit
        </button>
        <button v-if="canPin" class="menu-item" data-testid="mi-pin" @click="act(() => emit('pin'))()">
          {{ message.pinned ? "unpin" : "pin" }}
        </button>
        <button
          v-if="canDelete"
          class="menu-item text-danger"
          data-testid="mi-delete"
          @click="act(() => emit('delete'))()"
        >
          delete
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.menu-item {
  display: flex;
  width: 100%;
  align-items: center;
  padding: 10px 16px;
  font-size: var(--text-msg);
  color: var(--color-body);
  text-align: left;
}
.menu-item:hover {
  background: var(--color-canvas);
}
</style>
