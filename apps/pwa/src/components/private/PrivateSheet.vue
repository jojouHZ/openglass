// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { ref, watch } from "vue";
import Sheet from "../ui/Sheet.vue";
import Switch from "../ui/Switch.vue";

// Private session settings sheet — pwa-dev only. Only preferences are
// stored locally (lifetime + strict); nothing leaves the device here.
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ start: [opts: { ttlSeconds: number; strict: boolean }] }>();

const TTL_OPTIONS = [
  { label: "5 min", value: 300 },
  { label: "15 min", value: 900 },
  { label: "1 hour", value: 3600 },
];
const STORAGE_KEY = "og.private.prefs";

const ttl = ref(900);
const strict = ref(false);
const remember = ref(false);
const pattern = ref(true);

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    ttlSeconds: ttl.value, strict: strict.value, pattern: pattern.value,
  }));
}
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  if (saved && TTL_OPTIONS.some((o) => o.value === saved.ttlSeconds)) {
    ttl.value = saved.ttlSeconds;
    strict.value = saved.strict === true;
    pattern.value = saved.pattern !== false;
    remember.value = true;
  }
} catch { /* malformed local value is ignored */ }

watch(remember, (on) => {
  if (on) save();
  else localStorage.removeItem(STORAGE_KEY);
});
watch([ttl, strict, pattern], () => {
  if (remember.value) save();
});

function start() {
  emit("start", { ttlSeconds: ttl.value, strict: strict.value });
  open.value = false;
}
</script>

<template>
  <Sheet v-model:open="open" title="Private session settings" data-testid="private-sheet">
    <h2 class="text-name text-ink">private session</h2>
    <p class="mt-1 text-meta text-muted">
      the server relays opaque envelopes — it can't read messages, tell
      message types apart, or see what you verified
    </p>

    <div class="mt-6 text-sub text-muted">session lifetime</div>
    <div class="mt-2 flex gap-2">
      <button
        v-for="o in TTL_OPTIONS"
        :key="o.value"
        class="min-h-11 rounded-pill px-5 text-meta"
        :class="ttl === o.value ? 'bg-primary text-primary-foreground' : 'bg-bubble-in text-ink'"
        :data-testid="`ttl-${o.value}`"
        @click="ttl = o.value"
      >
        {{ o.label }}
      </button>
    </div>

    <label class="mt-6 flex min-h-11 items-center gap-3">
      <Switch v-model="strict" data-testid="opt-strict" />
      <span class="text-msg text-ink">strict mode
        <span class="text-meta text-muted">— any disconnect ends the session</span>
      </span>
    </label>
    <label class="flex min-h-11 items-center gap-3">
      <Switch v-model="pattern" data-testid="opt-pattern" />
      <span class="text-msg text-ink">patterned background
        <span class="text-meta text-muted">— off uses a plain gradient</span>
      </span>
    </label>
    <label class="flex min-h-11 items-center gap-3">
      <Switch v-model="remember" data-testid="opt-remember" />
      <span class="text-msg text-ink">remember these settings
        <span class="text-meta text-muted">— stored only on this device</span>
      </span>
    </label>

    <button
      class="mt-6 min-h-12 w-full rounded-pill bg-primary text-msg text-primary-foreground"
      data-testid="sheet-start"
      @click="start"
    >
      invite to private session
    </button>
  </Sheet>
</template>
