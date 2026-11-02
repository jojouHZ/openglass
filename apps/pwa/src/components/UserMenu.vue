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

// Context menu of a person row (right-click on desktop, long-press on touch).
// Anchored to a 1x1 virtual trigger at the pointer; Reka/floating-ui keeps it
// inside the viewport — same pattern as the message menu.
defineProps<{
  x: number;
  y: number;
  /** mutual contact: a chat exists to open and the contact can be removed */
  isContact: boolean;
}>();

const emit = defineEmits<{
  message: [];
  profile: [];
  report: [];
  remove: [];
  close: [];
}>();

const ITEM =
  "flex min-h-11 w-full cursor-default items-center px-4 text-left text-msg text-body outline-none data-[highlighted]:bg-canvas";
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-40 bg-scrim"
      data-testid="user-menu-scrim"
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
        class="z-50 w-48 rounded-card border border-line bg-card py-2 shadow-pop outline-none"
        side="bottom"
        align="start"
        :side-offset="4"
        :collision-padding="8"
        data-testid="user-menu"
        @close-auto-focus.prevent
      >
        <DropdownMenuItem
          v-if="isContact"
          :class="ITEM"
          data-testid="um-message"
          @select="emit('message'), emit('close')"
        >
          Message
        </DropdownMenuItem>
        <DropdownMenuItem :class="ITEM" data-testid="um-profile" @select="emit('profile'), emit('close')">
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem :class="ITEM" data-testid="um-report" @select="emit('report'), emit('close')">
          Report
        </DropdownMenuItem>
        <DropdownMenuItem
          v-if="isContact"
          :class="[ITEM, 'text-danger']"
          data-testid="um-remove"
          @select="emit('remove'), emit('close')"
        >
          Remove contact
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
