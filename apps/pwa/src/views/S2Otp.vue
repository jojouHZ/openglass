<!-- Copyright (C) 2025 OpenGlass contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<!-- S2 — OTP verification (flow 1). Resend honors the 60 s contract
     cooldown; otp_invalid surfaces attemptsLeft from error.details. -->

<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";

import { useSessionStore } from "@openglass/core";

import AppButton from "../components/AppButton.vue";
import OtpInput from "../components/OtpInput.vue";
import ScreenShell from "../components/ScreenShell.vue";
import { apiErrorDetails, apiErrorMessage } from "../errors";

const router = useRouter();
const session = useSessionStore();

const code = ref("");
const error = ref<string | null>(null);
const loading = ref(false);
const cooldown = ref(session.resendCooldownS);

let timer: ReturnType<typeof setInterval> | null = null;
function startCooldown() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (--cooldown.value <= 0 && timer) clearInterval(timer);
  }, 1000);
}
if (cooldown.value > 0) startCooldown();
onUnmounted(() => timer && clearInterval(timer));

const resendLabel = computed(() =>
  cooldown.value > 0 ? `resend code · ${cooldown.value}s` : "resend code",
);

async function submit() {
  error.value = null;
  loading.value = true;
  try {
    const r = await session.verifyOtp(code.value, "PWA — browser");
    await router.push({ name: r.needsProfile ? "s3-profile-setup" : "s4-chat-list" });
  } catch (e) {
    const left = apiErrorDetails(e)?.attemptsLeft;
    error.value =
      apiErrorMessage(e, {
        otp_invalid: "Wrong code",
        otp_expired: "Code expired — request a new one",
        unauthorized: "Verification failed — start over",
      }) + (typeof left === "number" ? ` (${left} attempts left)` : "");
    code.value = "";
  } finally {
    loading.value = false;
  }
}

async function resend() {
  if (cooldown.value > 0 || !session.pendingEmail) return;
  try {
    const r = await session.requestOtp(session.pendingEmail);
    cooldown.value = r.resendAvailableInS;
    startCooldown();
    error.value = null;
  } catch (e) {
    error.value = apiErrorMessage(e, { otp_cooldown: "Too soon — wait for the cooldown" });
  }
}
</script>

<template>
  <ScreenShell :back="() => router.push({ name: 's1-invite' })">
    <form class="flex flex-col items-center gap-6" @submit.prevent="submit">
      <h1 class="text-screen-title text-ink self-start">Check your email</h1>
      <p class="text-meta text-muted self-start">
        code sent to {{ session.pendingEmail ?? "—" }}
      </p>
      <OtpInput v-model="code" :disabled="loading" @complete="submit" />
      <p v-if="error" class="text-meta text-danger self-start">{{ error }}</p>
      <AppButton :loading="loading" :disabled="code.length !== 6">Verify</AppButton>
      <button
        type="button"
        class="text-meta text-muted"
        :class="cooldown === 0 && 'text-accent'"
        :disabled="cooldown > 0"
        @click="resend"
      >
        {{ resendLabel }}
      </button>
    </form>
  </ScreenShell>
</template>
