<!-- Copyright (C) 2025 OpenGlass contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<!-- S3 — profile setup (flow 1). Tag preview is a slugified hint only —
     the server binds the final `name#NNNN`. On tag_taken the
     contract's `details.tagSuggestions` render as tappable chips. -->

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";

import { useSessionStore } from "@openglass/core";

import AppButton from "../components/AppButton.vue";
import AppInput from "../components/AppInput.vue";
import ScreenShell from "../components/ScreenShell.vue";
import { apiErrorDetails, apiErrorMessage } from "../errors";

const router = useRouter();
const session = useSessionStore();

const displayName = ref("");
const requestedTag = ref("");
const suggestions = ref<string[]>([]);
const error = ref<string | null>(null);
const loading = ref(false);

const tagPreview = computed(() => {
  const slug = displayName.value.toLowerCase().replace(/\W+/g, "");
  return requestedTag.value || (slug ? `${slug}#????` : "name#0000");
});

async function submit() {
  error.value = null;
  suggestions.value = [];
  loading.value = true;
  try {
    await session.completeProfile(displayName.value.trim(), requestedTag.value || undefined);
    await router.push({ name: "s4-chat-list" });
  } catch (e) {
    const det = apiErrorDetails(e);
    const s = det?.tagSuggestions;
    if (Array.isArray(s)) suggestions.value = s.map(String);
    error.value = apiErrorMessage(e, {
      tag_taken: "That tag is taken — pick a suggestion or your own",
      conflict: "Profile already set up",
      validation_failed: "Display name is required",
    });
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <ScreenShell>
    <form class="flex flex-col gap-6" @submit.prevent="submit">
      <h1 class="text-screen-title text-ink">Set up profile</h1>
      <AppInput
        v-model="displayName"
        label="Display name"
        placeholder="display name"
        autocomplete="nickname"
        required
      />
      <AppInput v-model="tagPreview" label="Tag" readonly />
      <div v-if="suggestions.length" class="flex flex-wrap gap-2">
        <button
          v-for="s in suggestions"
          :key="s"
          type="button"
          class="rounded-pill border border-line px-3 py-1 text-meta text-accent"
          @click="requestedTag = s"
        >
          {{ s }}
        </button>
      </div>
      <p class="text-meta text-muted">
        tag is unique and immutable · display name can change later
      </p>
      <p v-if="error" class="text-meta text-danger">{{ error }}</p>
      <AppButton :loading="loading" :disabled="!displayName.trim()">Continue</AppButton>
    </form>
  </ScreenShell>
</template>
