// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ChevronLeft, Search } from "lucide-vue-next";

import type { User } from "@openglass/core";
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
  if (needle.length < 2) {
    // contract: q minLength 2 — shorter queries only filter locally
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

const addBusy = ref<string | null>(null);
async function add(userId: string) {
  if (addBusy.value) return;
  addBusy.value = userId;
  try {
    await contacts.add(userId);
  } catch {
    // transient failure — the row stays in global, user can retry
  } finally {
    addBusy.value = null;
  }
}
</script>

<template>
  <main class="flex min-h-dvh flex-col">
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

    <div class="flex-1 overflow-y-auto">
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
        <button
          class="rounded-pill border border-line px-3 py-1 text-meta text-ink disabled:opacity-40"
          :disabled="addBusy === u.id"
          data-testid="add-contact"
          @click="add(u.id)"
        >
          add
        </button>
      </UserRow>

      <div
        v-if="!local.length && !globalFiltered.length && !searching"
        class="grid h-full place-items-center px-6"
        data-testid="empty"
      >
        <div class="flex flex-col items-center gap-3 text-center">
          <div class="text-body text-ink">
            {{ q.trim().length >= 2 ? "no results" : "no contacts yet" }}
          </div>
          <div class="text-meta text-muted">
            {{ q.trim().length >= 2 ? `nothing found for "${q.trim()}"` : "find people by tag to start" }}
          </div>
        </div>
      </div>
    </div>
  </main>
</template>
