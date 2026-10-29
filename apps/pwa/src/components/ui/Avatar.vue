// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { computed } from "vue";

import { avatarBackground, initials } from "../../lib/avatar";

const props = withDefaults(
  defineProps<{
    name: string;
    /** colour seed — the user's tag; falls back to the name */
    tag?: string | null;
    src?: string | null;
    size?: "sm" | "md" | "lg";
  }>(),
  { tag: null, src: null, size: "md" },
);

const bg = computed(() => avatarBackground(props.tag || props.name));
const text = computed(() => initials(props.name));
const box = computed(
  () => ({ sm: "size-7 text-sub", md: "size-11 text-body", lg: "size-20 text-header" })[props.size],
);
</script>

<template>
  <span
    class="inline-grid shrink-0 select-none place-items-center overflow-hidden rounded-full font-sans font-semibold text-white"
    :class="box"
    :style="src ? undefined : { background: bg }"
    aria-hidden="true"
  >
    <img v-if="src" :src="src" alt="" class="size-full object-cover" />
    <template v-else>{{ text }}</template>
  </span>
</template>
