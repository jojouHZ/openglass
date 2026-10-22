// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ChevronLeft, Search, Users } from "lucide-vue-next";

import type { ContactRequest, User } from "@openglass/core";
import { api, useContactsStore, useSessionStore } from "@openglass/core";

import UserRow from "../components/UserRow.vue";

const router = useRouter();
const contacts = useContactsStore();
const session = useSessionStore();

const q = ref("");
const global = ref<User[]>([]);
const searching = ref(false);
let timer: ReturnType<typeof setTimeout>;

// contacts section: local roster filtered by the query (empty → all)
const local = computed(() => contacts.searchLocal(q.value));

// global section: server results minus my contacts and myself —
// a contact must not show up twice in both sections
const globalFiltered = computed(() =>
  global.value.filter(
    (u) => u.id !== session.user?.id && !contacts.isContact(u.id),
  ),
);

watch(q, (v) => {
  clearTimeout(timer);
  const needle = v.trim();
  if (!needle) {
    // empty query only filters locally — no server round-trip
    global.value = [];
    searching.value = false;
    return;
  }
  searching.value = true;
  timer = setTimeout(async () => {
    try {
      const { users } = await api().users.search(needle);
      if (q.value.trim() === needle) global.value = users;
    } catch {
      global.value = [];
    } finally {
      searching.value = false;
    }
  }, 300);
});

onMounted(() => void contacts.refresh().catch(() => undefined));
onBeforeUnmount(() => clearTimeout(timer));

const openProfile = (u: User) =>
  router.push({ name: "s7-contact-profile", params: { userId: u.id } });

const busyId = ref<string | null>(null);
async function run(userId: string, fn: () => Promise<unknown>) {
  if (busyId.value) return;
  busyId.value = userId;
  try {
    await fn();
  } catch {
    // transient failure — the row stays where it is, user can retry
  } finally {
    busyId.value = null;
  }
}
const sendRequest = (userId: string) => run(userId, () => contacts.sendRequest(userId));
const accept = (r: ContactRequest) => run(r.user.id, () => contacts.accept(r.user.id));
const decline = (r: ContactRequest) => run(r.user.id, () => contacts.decline(r.user.id));
const cancel = (r: ContactRequest) => run(r.user.id, () => contacts.cancel(r.user.id));
</script>

<template>
  <main class="flex h-dvh flex-col overflow-hidden">
    <div class="flex items-center gap-3 px-6 pb-4 pt-8">
      <button
        class="grid size-10 shrink-0 place-items-center text-ink"
        aria-label="back"
        @click="router.back()"
      >
        <ChevronLeft class="size-5" :stroke-width="1.25" />
      </button>
      <div class="flex min-w-0 flex-1 items-center gap-2 rounded-input bg-canvas px-3 py-2">
        <Search class="size-4 shrink-0 text-muted" :stroke-width="1.5" />
        <input
          v-model="q"
          class="w-full bg-transparent text-msg text-ink outline-none placeholder:text-muted"
          placeholder="name or tag…"
          data-testid="contact-search-input"
          autofocus
        />
      </div>
    </div>

    <button
      class="flex w-full items-center gap-3 px-6 py-3 text-left hover:bg-canvas"
      data-testid="new-group"
      @click="router.push({ name: 's8-group-create' })"
    >
      <span class="grid size-[52px] shrink-0 place-items-center rounded-full bg-soft text-ink">
        <Users class="size-5" :stroke-width="1.5" />
      </span>
      <span class="text-name text-ink">new group</span>
    </button>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="contacts.incoming.length" class="px-6 pb-1 pt-2 text-meta text-muted" data-testid="requests-header">
        requests · {{ contacts.incoming.length }}
      </div>
      <UserRow
        v-for="r in contacts.incoming"
        :key="`in-${r.user.id}`"
        :user="r.user"
        data-testid="incoming-request"
        @open="openProfile(r.user)"
      >
        <div class="flex gap-2">
          <button
            class="rounded-pill bg-ink px-3 py-1 text-meta text-bg disabled:opacity-40"
            :disabled="busyId === r.user.id"
            data-testid="req-accept"
            @click.stop="accept(r)"
          >
            accept
          </button>
          <button
            class="rounded-pill border border-line px-3 py-1 text-meta text-ink disabled:opacity-40"
            :disabled="busyId === r.user.id"
            data-testid="req-decline"
            @click.stop="decline(r)"
          >
            decline
          </button>
        </div>
      </UserRow>

      <div v-if="!q.trim() && contacts.outgoing.length" class="px-6 pb-1 pt-2 text-meta text-muted">
        sent · {{ contacts.outgoing.length }}
      </div>
      <UserRow
        v-for="r in q.trim() ? [] : contacts.outgoing"
        :key="`out-${r.user.id}`"
        :user="r.user"
        data-testid="outgoing-request"
        @open="openProfile(r.user)"
      >
        <div class="flex items-center gap-2">
          <span class="text-meta text-muted">pending</span>
          <button
            class="rounded-pill border border-line px-3 py-1 text-meta text-ink disabled:opacity-40"
            :disabled="busyId === r.user.id"
            data-testid="req-cancel"
            @click.stop="cancel(r)"
          >
            cancel
          </button>
        </div>
      </UserRow>

      <div v-if="local.length" class="px-6 pb-1 pt-2 text-meta text-muted">contacts</div>
      <UserRow
        v-for="c in local"
        :key="c.user.id"
        :user="c.user"
        @open="openProfile(c.user)"
      >
        <svg
          viewBox="0 0 24 24" class="size-4 text-muted" fill="none"
          stroke="currentColor" stroke-width="2"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </UserRow>

      <div v-if="globalFiltered.length" class="px-6 pb-1 pt-2 text-meta text-muted">global</div>
      <UserRow
        v-for="u in globalFiltered"
        :key="u.id"
        :user="u"
        @open="openProfile(u)"
      >
        <span
          v-if="contacts.hasOutgoing(u.id)"
          class="text-meta text-muted"
          data-testid="request-sent"
        >
          requested
        </span>
        <button
          v-else-if="contacts.hasIncoming(u.id)"
          class="rounded-pill bg-ink px-3 py-1 text-meta text-bg disabled:opacity-40"
          :disabled="busyId === u.id"
          data-testid="accept-contact"
          @click.stop="contacts.accept(u.id).catch(() => undefined)"
        >
          accept
        </button>
        <button
          v-else
          class="rounded-pill border border-line px-3 py-1 text-meta text-ink disabled:opacity-40"
          :disabled="busyId === u.id"
          data-testid="add-contact"
          @click.stop="sendRequest(u.id)"
        >
          request
        </button>
      </UserRow>

      <div
        v-if="!local.length && !globalFiltered.length && !contacts.incoming.length && !contacts.outgoing.length && !searching"
        class="grid h-full place-items-center px-6"
        data-testid="empty"
      >
        <div class="flex flex-col items-center gap-3 text-center">
          <div class="text-body text-ink">
            {{ q.trim() ? "no results" : "no contacts yet" }}
          </div>
          <div class="text-meta text-muted">
            {{ q.trim() ? `nothing found for "${q.trim()}"` : "find people by tag to start" }}
          </div>
        </div>
      </div>
    </div>
  </main>
</template>
