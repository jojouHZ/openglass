<!-- Copyright (C) 2025 OpenGlass contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<!-- Temporary scaffold view — replaced by real screens starting
     with S1–S3 (issue #10). Renders the screen ID so route smoke
     tests can assert the mapping. -->

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const screen = computed(() => route.meta.screen ?? "?");
const name = computed(() => String(route.name ?? ""));
</script>

<template>
  <main class="flex min-h-dvh items-center justify-center p-6">
    <div class="text-center">
      <p class="text-screen-title text-ink">{{ screen }}</p>
      <p class="text-meta text-muted mt-2">{{ name }}</p>
    </div>
  </main>
</template>
