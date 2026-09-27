<!-- Copyright (C) 2025 OpenGlass contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<!-- App shell: mobile grid rows per docs/ux/design-tokens.md —
     chrome rows (header/nav) are shell rows, only the 1fr row scrolls. -->

<script setup lang="ts">
import { RouterView } from "vue-router";
</script>

<template>
  <div class="grid min-h-dvh grid-rows-[auto_1fr_auto]">
    <RouterView />
  </div>
</template>
