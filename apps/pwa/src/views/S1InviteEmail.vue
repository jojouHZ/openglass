<!-- Copyright (C) 2025 OpenGlass contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<!-- S1 — invite code + email → requestOtp (flow 1, docs/ux/flows.md).
     Invite is only required for a NEW email; a returning account can
     leave it blank (re-login per contract). -->

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";

import { useSessionStore } from "@openglass/core";

import AppButton from "../components/AppButton.vue";
import AppInput from "../components/AppInput.vue";
import ScreenShell from "../components/ScreenShell.vue";
import { apiErrorMessage } from "../errors";

const router = useRouter();
const session = useSessionStore();

const invite = ref("");
const email = ref("");
const error = ref<string | null>(null);
const loading = ref(false);

async function submit() {
  error.value = null;
  loading.value = true;
  try {
    await session.requestOtp(email.value.trim(), invite.value.trim() || undefined);
    await router.push({ name: "s2-otp" });
  } catch (e) {
    error.value = apiErrorMessage(e, {
      invite_required: "This email is new — an invite code is required",
      invite_invalid: "Invite code is not valid",
      validation_failed: "Enter a valid email address",
    });
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <ScreenShell>
    <form class="flex flex-col gap-6" @submit.prevent="submit">
      <h1 class="text-screen-title text-ink">OpenGlass</h1>
      <AppInput
        v-model="invite"
        label="Invite code"
        placeholder="invite code"
        autocomplete="off"
      />
      <AppInput
        v-model="email"
        label="Email"
        placeholder="email"
        type="email"
        autocomplete="email"
        required
      />
      <p v-if="error" class="text-meta text-danger">{{ error }}</p>
      <AppButton :loading="loading" :disabled="!email">Request code</AppButton>
    </form>
  </ScreenShell>
</template>
