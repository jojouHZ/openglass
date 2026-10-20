<!-- Copyright (C) 2025 OpenGlass contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from "reka-ui";

// Compact toggle on Reka's Switch (role=switch, keyboard, aria-checked).
const model = defineModel<boolean>({ default: false });
</script>

<template>
  <SwitchRoot
    v-model="model"
    class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-soft outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:bg-ink"
  >
    <SwitchThumb
      class="block size-5 translate-x-0.5 rounded-full bg-bg shadow-pop transition-transform data-[state=checked]:translate-x-[22px]"
    />
  </SwitchRoot>
</template>
