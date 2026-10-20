// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from "reka-ui";

import type { LocalMessage } from "@openglass/core";

// Message context menu — s5a. Reactions are NOT in the API contract,
// so the kit's react-bar is intentionally omitted (no invented fields).
// Positioning is delegated to Reka/floating-ui: the menu anchors to a
// 1x1 virtual trigger at the pointer and flips/shifts inside the viewport.

defineProps<{
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

const ITEM =
  "flex w-full cursor-default items-center px-4 py-2.5 text-left text-msg text-body outline-none data-[highlighted]:bg-canvas";
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-40 bg-ink/30"
      data-testid="menu-scrim"
      @click="emit('close')"
      @contextmenu.prevent="emit('close')"
    />
  </Teleport>
  <DropdownMenuRoot :open="true" :modal="false" @update:open="(v) => !v && emit('close')">
    <DropdownMenuTrigger
      class="pointer-events-none fixed size-px opacity-0"
      :style="{ left: x + 'px', top: y + 'px' }"
      tabindex="-1"
      aria-hidden="true"
    />
    <DropdownMenuPortal>
      <DropdownMenuContent
        class="z-50 w-44 rounded-card border border-line bg-bg py-2 shadow-pop outline-none"
        side="bottom"
        align="start"
        :side-offset="4"
        :collision-padding="8"
        data-testid="message-menu"
        @close-auto-focus.prevent
      >
        <DropdownMenuItem :class="ITEM" data-testid="mi-reply" @select="emit('reply'), emit('close')">
          reply
        </DropdownMenuItem>
        <DropdownMenuItem :class="ITEM" data-testid="mi-copy" @select="emit('copy'), emit('close')">
          copy
        </DropdownMenuItem>
        <DropdownMenuItem
          v-if="own"
          :class="ITEM"
          data-testid="mi-edit"
          @select="emit('edit'), emit('close')"
        >
          edit
        </DropdownMenuItem>
        <DropdownMenuItem
          v-if="canPin"
          :class="ITEM"
          data-testid="mi-pin"
          @select="emit('pin'), emit('close')"
        >
          {{ message.pinned ? "unpin" : "pin" }}
        </DropdownMenuItem>
        <DropdownMenuItem
          v-if="canDelete"
          :class="[ITEM, 'text-danger']"
          data-testid="mi-delete"
          @select="emit('delete'), emit('close')"
        >
          delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
