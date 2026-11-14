// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ChevronLeft, Shield, ShieldAlert, ShieldCheck } from "lucide-vue-next";

import type { Relationship, User } from "@openglass/core";
import { api, ApiRequestError, useContactsStore } from "@openglass/core";

import AppButton from "../components/AppButton.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import ReportDialog from "../components/ReportDialog.vue";
import { usePeerVerification } from "../privateRemote";

const route = useRoute();
const router = useRouter();
const contacts = useContactsStore();

const privateModule = import.meta.env.VITE_PRIVATE_MODULE === "1";

const userId = computed(() => String(route.params.userId));
const user = ref<User | null>(null);
const relationship = ref<Relationship>("none");
const loading = ref(true);
const notFound = ref(false);
const busy = ref(false);
const errorMsg = ref("");
const loadFailed = ref(false);
const confirmRemove = ref(false);
const reporting = ref(false);

// Device-pin cue — null in the mvp build: no remote, no cue.
const verification = usePeerVerification(() => userId.value);
const verifyCue = computed(() => {
  const v = verification.value;
  if (!v) return null;
  switch (v.state) {
    case "verified": return { label: "device verified", warn: false };
    case "key-changed": return { label: "key changed — re-verify", warn: true };
    case "pending": return { label: "verification pending", warn: false };
    default: return { label: "device not verified", warn: false };
  }
});

async function load() {
  loading.value = true;
  errorMsg.value = "";
  loadFailed.value = false;
  try {
    const r = await api().users.get(userId.value);
    user.value = r.user;
    relationship.value = r.relationship;
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) notFound.value = true;
    else if (!user.value) loadFailed.value = true;
    else errorMsg.value = "failed to load profile";
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const badge = computed(() => {
  switch (relationship.value) {
    case "contact_incoming": return "wants to connect";
    case "contact_outgoing": return "request sent";
    case "contact_mutual": return "mutual contact";
    case "self": return "this is you";
    default: return null;
  }
});

async function act(fn: () => Promise<unknown>, failMsg: string) {
  if (busy.value) return;
  busy.value = true;
  errorMsg.value = "";
  try {
    await fn();
    await load(); // refetch — the relationship is derived server-side
  } catch {
    errorMsg.value = failMsg;
  } finally {
    busy.value = false;
  }
}

const sendRequest = () => act(() => contacts.sendRequest(userId.value), "failed to send request");
const accept = () => act(() => contacts.accept(userId.value), "failed to accept request");
const decline = () => act(() => contacts.decline(userId.value), "failed to decline request");
const cancel = () => act(() => contacts.cancel(userId.value), "failed to cancel request");

async function remove() {
  if (busy.value) return;
  busy.value = true;
  errorMsg.value = "";
  try {
    await contacts.remove(userId.value);
    confirmRemove.value = false;
    await load();
  } catch {
    errorMsg.value = "failed to remove contact";
  } finally {
    busy.value = false;
  }
}

/** pwa-dev only — the button doesn't render in pwa-mvp. */
async function privateSession() {
  if (busy.value) return;
  busy.value = true;
  errorMsg.value = "";
  try {
    const { chat } = await api().chats.openDirect(userId.value);
    // Private layer is same-window: open the chat; the user flips the lock there.
    router.push({ name: "s5-chat-view", params: { chatId: chat.id }, query: { layer: "private" } });
  } catch {
    errorMsg.value = "failed to open chat";
  } finally {
    busy.value = false;
  }
}

/** pwa-dev only — opens the chat straight into the device ritual. */
async function verifyDevice() {
  if (busy.value) return;
  busy.value = true;
  errorMsg.value = "";
  try {
    const { chat } = await api().chats.openDirect(userId.value);
    router.push({ name: "s5-chat-view", params: { chatId: chat.id }, query: { verify: "1" } });
  } catch {
    errorMsg.value = "failed to open chat";
  } finally {
    busy.value = false;
  }
}

async function message() {
  if (busy.value) return;
  busy.value = true;
  errorMsg.value = "";
  try {
    const { chat } = await api().chats.openDirect(userId.value);
    router.push({ name: "s5-chat-view", params: { chatId: chat.id } });
  } catch (e) {
    // server enforces mutual contacts — surface it, never mask
    errorMsg.value =
      e instanceof ApiRequestError && e.status === 403
        ? "add each other first — direct chats need mutual contacts"
        : "failed to open chat";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="flex h-full flex-col overflow-hidden">
    <div class="flex items-center px-6 pb-4 pt-8">
      <button
        class="grid size-11 place-items-center text-ink"
        aria-label="back"
        @click="router.back()"
      >
        <ChevronLeft class="size-5" :stroke-width="1.25" />
      </button>
    </div>

    <div v-if="loading" class="grid flex-1 place-items-center text-meta text-muted">
      loading…
    </div>

    <div
      v-else-if="notFound"
      class="grid flex-1 place-items-center px-6 text-center"
      data-testid="not-found"
    >
      <div class="flex flex-col items-center gap-3">
        <div class="text-body text-ink">user not found</div>
        <div class="text-meta text-muted">the profile may have been removed</div>
      </div>
    </div>

    <div
      v-else-if="loadFailed"
      class="grid flex-1 place-items-center px-6 text-center"
      role="alert"
      data-testid="load-error"
    >
      <div class="flex flex-col items-center gap-3">
        <div class="text-body text-ink">couldn't load this profile</div>
        <div class="text-meta text-muted">check your connection and try again</div>
        <button
          class="mt-1 h-11 rounded-pill bg-primary px-6 text-msg text-primary-foreground"
          data-testid="load-retry"
          @click="load"
        >
          retry
        </button>
      </div>
    </div>

    <div v-else-if="user" class="flex min-h-0 flex-1 flex-col items-center gap-6 overflow-y-auto px-6 pt-4">
      <span
        class="grid size-24 place-items-center rounded-full bg-bubble-in text-header text-muted"
        data-testid="avatar"
      >
        {{ user.displayName.slice(0, 1) }}
      </span>
      <div class="flex flex-col items-center gap-1 text-center">
        <div class="text-header text-ink" data-testid="display-name">{{ user.displayName }}</div>
        <div class="text-msg text-muted" data-testid="tag">{{ user.tag }}</div>
        <div v-if="badge" class="mt-1 rounded-pill bg-soft px-3 py-1 text-meta text-muted" data-testid="badge">
          {{ badge }}
        </div>
      </div>

      <div class="flex w-[min(342px,100%)] flex-col gap-3">
        <AppButton
          v-if="relationship === 'contact_mutual'"
          :loading="busy"
          data-testid="action-message"
          @click="message"
        >
          message
        </AppButton>
        <template v-else-if="relationship === 'contact_incoming'">
          <AppButton :loading="busy" data-testid="action-accept" @click="accept">accept</AppButton>
          <button
            class="h-11 w-full rounded-input border border-line text-msg text-ink"
            :disabled="busy"
            data-testid="action-decline"
            @click="decline"
          >
            decline
          </button>
        </template>
        <AppButton
          v-else-if="relationship === 'none'"
          :loading="busy"
          data-testid="action-add"
          @click="sendRequest"
        >
          send request
        </AppButton>
        <div
          v-else-if="relationship === 'contact_outgoing'"
          class="flex flex-col gap-3"
        >
          <div class="text-center text-meta text-muted" data-testid="request-pending">
            waiting for {{ user.displayName }} to accept
          </div>
          <button
            class="h-11 w-full rounded-input border border-line text-msg text-ink"
            :disabled="busy"
            data-testid="action-resend"
            @click="sendRequest"
          >
            send again
          </button>
          <button
            class="h-11 w-full rounded-input text-msg text-danger"
            :disabled="busy"
            data-testid="action-cancel"
            @click="cancel"
          >
            cancel request
          </button>
        </div>

        <button
          v-if="privateModule && relationship === 'contact_mutual'"
          class="h-11 w-full rounded-input border border-line text-msg text-ink"
          data-testid="action-private"
          @click="privateSession"
        >
          private session
        </button>

        <button
          v-if="verifyCue && relationship === 'contact_mutual'"
          class="flex h-11 w-full items-center justify-center gap-2 rounded-input border text-msg"
          :class="
            verifyCue.warn
              ? 'border-danger/50 text-danger'
              : 'border-line text-muted'
          "
          data-testid="device-verification-cue"
          @click="verifyDevice"
        >
          <ShieldAlert v-if="verifyCue.warn" class="size-4" :stroke-width="1.5" />
          <ShieldCheck
            v-else-if="verification?.state === 'verified'"
            class="size-4"
            :stroke-width="1.5"
          />
          <Shield v-else class="size-4" :stroke-width="1.5" />
          {{ verifyCue.label }}
        </button>

        <button
          v-if="relationship === 'contact_mutual'"
          class="h-11 w-full rounded-input text-msg text-danger"
          data-testid="action-remove"
          @click="confirmRemove = true"
        >
          remove contact
        </button>

        <button
          v-if="relationship !== 'self'"
          class="h-11 w-full rounded-input text-meta text-muted"
          data-testid="action-report"
          @click="reporting = true"
        >
          report
        </button>

        <div v-if="errorMsg" class="text-center text-meta text-danger" data-testid="error">
          {{ errorMsg }}
        </div>
      </div>
    </div>

    <ReportDialog
      v-if="reporting && user"
      :user-id="user.id"
      :name="user.displayName ?? ''"
      @close="reporting = false"
    />

    <ConfirmDialog
      v-if="confirmRemove && user"
      title="remove contact?"
      :body="`${user.displayName} will be removed from your contacts, and you from theirs. Existing chats stay.`"
      confirm-label="remove"
      :busy="busy"
      @confirm="remove"
      @cancel="confirmRemove = false"
    />
  </main>
</template>
