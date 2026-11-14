// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { ShieldAlert, ShieldCheck } from "lucide-vue-next";

import type { User } from "@openglass/core";
import { useContactsStore, useSessionStore } from "@openglass/core";

import { useOpenChat } from "../composables/openChat";
import { usePeerVerification } from "../privateRemote";
import ConfirmDialog from "./ConfirmDialog.vue";
import ReportDialog from "./ReportDialog.vue";
import UserMenu from "./UserMenu.vue";
import Avatar from "./ui/Avatar.vue";

// several root nodes (row + menu + dialogs): attrs go to the row explicitly
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  user: User;
  subtitle?: string;
  /** right-click / long-press menu (Message · Profile · Report · Remove) */
  menu?: boolean;
}>();
const emit = defineEmits<{ open: [] }>();

const contacts = useContactsStore();
const session = useSessionStore();
const nav = useOpenChat();

const isSelf = computed(() => props.user.id === session.user?.id);
const menuEnabled = computed(() => !!props.menu && !isSelf.value);

// device-pin cue (dev PWA): shield for a verified device, alert shield
// when the shown key differs from the pin — null-safe in the mvp build
const verification = usePeerVerification(() => props.user.id);
const shield = computed(() => {
  const s = verification.value?.state;
  if (s === "verified") return "verified";
  if (s === "key-changed") return "key-changed";
  return null;
});

// ---- gesture: right-click, or a still 500 ms touch (scrolling cancels it) ----
const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 8;
const open_ = ref<{ x: number; y: number } | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;
let start: { x: number; y: number } | null = null;
let suppressClick = false;

function cancelPress() {
  if (timer) clearTimeout(timer);
  timer = null;
  start = null;
}
onBeforeUnmount(cancelPress);

function onContextMenu(e: MouseEvent) {
  if (!menuEnabled.value) return;
  e.preventDefault();
  open_.value = { x: e.clientX, y: e.clientY };
}
function onPointerDown(e: PointerEvent) {
  if (!menuEnabled.value || e.pointerType === "mouse") return; // mouse uses the context menu event
  start = { x: e.clientX, y: e.clientY };
  timer = setTimeout(() => {
    open_.value = { x: start?.x ?? 0, y: start?.y ?? 0 };
    suppressClick = true; // the lift of the finger must not also "tap"
    timer = null;
  }, LONG_PRESS_MS);
}
function onPointerMove(e: PointerEvent) {
  if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOLERANCE) cancelPress();
}
function onClick() {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  emit("open");
}

// ---- menu actions ----
const reporting = ref(false);
const confirmRemove = ref(false);
const removing = ref(false);

async function remove() {
  removing.value = true;
  try {
    await contacts.remove(props.user.id);
    confirmRemove.value = false;
  } finally {
    removing.value = false;
  }
}
</script>

<template>
  <button
    class="flex w-full items-center gap-3 px-6 py-3 text-left hover:bg-canvas"
    data-testid="user-row"
    v-bind="$attrs"
    @click="onClick"
    @contextmenu="onContextMenu"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="cancelPress"
    @pointercancel="cancelPress"
    @pointerleave="cancelPress"
  >
    <Avatar :name="user.displayName" :tag="user.tag" />
    <span class="min-w-0 flex-1">
      <span class="flex items-center gap-1.5 truncate text-name font-semibold text-ink" data-testid="user-name">
        <span class="truncate">{{ user.displayName }}</span>
        <ShieldAlert
          v-if="shield === 'key-changed'"
          class="size-3.5 shrink-0 text-danger"
          :stroke-width="1.5"
          data-testid="user-key-changed"
          aria-label="device key changed"
        />
        <ShieldCheck
          v-else-if="shield === 'verified'"
          class="size-3.5 shrink-0 text-muted"
          :stroke-width="1.5"
          data-testid="user-verified"
          aria-label="device verified"
        />
      </span>
      <span class="block truncate text-msg text-muted" data-testid="user-tag">
        {{ subtitle ?? user.tag }}
      </span>
    </span>
    <span class="shrink-0" @click.stop>
      <slot />
    </span>
  </button>

  <UserMenu
    v-if="open_"
    :x="open_.x"
    :y="open_.y"
    :is-contact="contacts.isContact(user.id)"
    @message="nav.chat(user.id)"
    @profile="nav.profile(user.id)"
    @report="reporting = true"
    @remove="confirmRemove = true"
    @close="open_ = null"
  />
  <ReportDialog v-if="reporting" :user-id="user.id" :name="user.displayName" @close="reporting = false" />
  <ConfirmDialog
    v-if="confirmRemove"
    title="remove contact?"
    :body="`${user.displayName} will be removed from your contacts, and you from theirs. The chat stays as an archive.`"
    confirm-label="remove"
    :busy="removing"
    @confirm="remove"
    @cancel="confirmRemove = false"
  />
</template>
