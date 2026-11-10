// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import type { VerificationView } from "@openglass/core/private/remote";
import { usePrivateRemote } from "../../privateRemote";
import { SAS_OBJECTS } from "../../private/sasSymbols";

const props = defineProps<{ peerId: string; peerName: string }>();
const emit = defineEmits<{ confirmed: []; cancel: [] }>();
const remote = usePrivateRemote();
const view = shallowRef<VerificationView | null>(null);
const busy = ref(false);
const error = ref("");
const selected = ref("");
let mounted = true;
const off = remote.watchVerification(props.peerId, (snapshot) => { view.value = snapshot; });

async function start(keyId?: string) {
  busy.value = true;
  error.value = "";
  try {
    await remote.startVerification(props.peerId, keyId);
    if (mounted) selected.value = keyId ?? view.value?.devices[0]?.keyId ?? "";
  } catch {
    if (mounted) error.value = "Device keys could not be loaded. Try again.";
  } finally {
    if (mounted) busy.value = false;
  }
}

async function confirm() {
  if (busy.value || !view.value?.fingerprint) return;
  busy.value = true;
  error.value = "";
  try {
    await remote.confirmVerification(props.peerId);
    if (mounted && view.value?.state === "verified") emit("confirmed");
  } catch {
    if (mounted) error.value = "Verification could not be saved. Try again.";
  } finally {
    if (mounted) busy.value = false;
  }
}

function reject() {
  remote.rejectVerification(props.peerId);
  emit("cancel");
}

onMounted(() => { void start(); });
onBeforeUnmount(() => {
  mounted = false;
  off();
  remote.rejectVerification(props.peerId);
});
</script>

<template>
  <section class="mx-4 my-3 rounded-card border border-line bg-bg p-4" aria-label="verify device" data-testid="device-verification">
    <h2 class="text-name text-ink">Verify {{ peerName }}'s device</h2>
    <p class="mt-2 text-meta text-muted">Compare all six objects and digits over a call, in person, or another channel you already trust. Both people must confirm on their own device.</p>
    <p v-if="view?.state === 'key-changed'" class="mt-2 text-meta text-danger" role="alert">This device key differs from your saved check. Do not confirm unless you have verified the new device.</p>
    <label v-if="view?.devices.length" class="mt-3 block text-meta text-muted">
      Contact's device
      <select v-model="selected" class="mt-1 min-h-11 w-full rounded-control border border-line bg-bg px-3 text-ink" :disabled="busy" data-testid="verification-device" @change="start(selected)">
        <option v-for="device in view.devices" :key="device.keyId" :value="device.keyId">{{ device.label || 'Device' }} · {{ device.keyId.slice(0, 12) }}</option>
      </select>
    </label>
    <p v-if="busy" class="mt-3 text-meta text-muted" role="status">Working…</p>
    <p v-else-if="!view?.devices.length && !error" class="mt-3 text-meta text-muted">No published devices. Ask your contact to open OpenGlass, then retry.</p>
    <div v-if="!busy && view?.fingerprint" class="mt-4" data-testid="verification-fingerprint">
      <div class="grid grid-cols-3 gap-3">
        <div v-for="(index, position) in view.fingerprint.symbols" :key="position" class="flex flex-col items-center gap-1">
          <component :is="SAS_OBJECTS[index]?.icon" class="size-8 text-ink" :stroke-width="1.75" aria-hidden="true" />
          <span class="text-meta text-muted">{{ SAS_OBJECTS[index]?.label }}</span>
        </div>
      </div>
      <p class="mt-4 text-center font-mono text-2xl tracking-widest text-ink" data-testid="verification-digits">{{ view.fingerprint.digits }}</p>
    </div>
    <p v-if="error" role="alert" class="mt-3 text-meta text-danger">{{ error }}</p>
    <div class="mt-4 flex flex-wrap gap-2">
      <button class="min-h-11 rounded-pill border border-line px-4 text-meta text-ink" data-testid="verification-reject" @click="reject">Cancel / doesn't match</button>
      <button v-if="error || !view?.devices.length" class="min-h-11 rounded-pill border border-line px-4 text-meta text-ink" :disabled="busy" @click="start()">Retry</button>
      <button class="min-h-11 rounded-pill bg-primary px-4 text-meta text-primary-foreground disabled:opacity-40" :disabled="busy || !view?.fingerprint || !!error" data-testid="verification-confirm" @click="confirm">All objects and digits match</button>
    </div>
  </section>
</template>
