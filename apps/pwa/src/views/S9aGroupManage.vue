// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import {
  ApiRequestError,
  useChatsStore,
  useContactsStore,
  useSessionStore,
  type GroupMember,
} from "@openglass/core";

import AppButton from "../components/AppButton.vue";
import AppInput from "../components/AppInput.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import UserRow from "../components/UserRow.vue";

const route = useRoute();
const router = useRouter();
const chats = useChatsStore();
const contacts = useContactsStore();
const session = useSessionStore();

const chatId = String(route.params.chatId);
const chat = computed(() => chats.details[chatId]);
const members = computed(() => chat.value?.members ?? []);
const me = computed(() => chats.myMember(chatId));
const isOwner = computed(() => me.value?.role === "owner");
const canInvite = computed(() => isOwner.value || !!me.value?.rights?.inviteMembers);
const canRemove = computed(() => isOwner.value || !!me.value?.rights?.removeMembers);
const canEditInfo = computed(() => isOwner.value || !!me.value?.rights?.editInfo);

// ---- member action sheet ----
const sheet = ref<GroupMember | null>(null);
const sheetError = ref("");
const pageError = ref("");
const busy = ref(false);

// rights toggles on the sheet — owner only (contract: PATCH rights)
const RIGHT_KEYS = [
  ["inviteMembers", "invite"],
  ["editInfo", "edit"],
  ["pinMessages", "pin"],
  ["removeMembers", "kick"],
  ["deleteMessages", "del msgs"],
] as const;

function rightLabel(m: GroupMember): string {
  if (m.role === "owner") return "owner";
  return RIGHT_KEYS.filter(([k]) => m.rights?.[k]).map(([, l]) => l).join(" · ");
}

async function toggleRight(m: GroupMember, key: (typeof RIGHT_KEYS)[number][0]) {
  if (!isOwner.value || m.role === "owner") return;
  const rights = { ...m.rights, [key]: !m.rights?.[key] };
  busy.value = true;
  try {
    await chats.setMemberRights(chatId, m.user.id, rights);
    sheet.value = members.value.find((x) => x.user.id === m.user.id) ?? null;
  } catch {
    sheetError.value = "could not update rights";
  } finally {
    busy.value = false;
  }
}

function onMemberTap(m: GroupMember) {
  const manageable =
    m.user.id !== session.user?.id &&
    (isOwner.value || (canRemove.value && m.role !== "owner"));
  if (manageable) {
    sheet.value = m;
    sheetError.value = "";
  } else {
    router.push({ name: "s7-contact-profile", params: { userId: m.user.id } });
  }
}

// ---- destructive confirmations ----
const confirmKind = ref<"remove" | "leave" | "transfer" | null>(null);
const confirmMember = ref<GroupMember | null>(null);

const confirmCopy = computed(() => {
  const name = confirmMember.value?.user.displayName;
  switch (confirmKind.value) {
    case "remove":
      return { title: `remove ${name}?`, body: "they can be added back later", action: "remove" };
    case "transfer":
      return { title: `make ${name} the owner?`, body: "you will lose owner rights", action: "transfer" };
    default:
      return { title: "leave group?", body: "you can rejoin only if someone adds you back", action: "leave" };
  }
});

async function confirmAction() {
  const kind = confirmKind.value;
  confirmKind.value = null;
  if (kind === "leave") {
    await chats.leaveGroup(chatId);
    router.push({ name: "s4-chat-list" });
    return;
  }
  if (!confirmMember.value) return;
  busy.value = true;
  try {
    if (kind === "remove") {
      await chats.removeGroupMember(chatId, confirmMember.value.user.id);
      sheet.value = null;
    } else {
      await chats.transferOwnership(chatId, confirmMember.value.user.id);
      sheet.value = members.value.find((x) => x.user.id === confirmMember.value!.user.id) ?? null;
    }
  } catch {
    sheetError.value = "action failed — check your rights";
  } finally {
    busy.value = false;
    confirmMember.value = null;
  }
}

// ---- add member picker ----
const addMode = ref(false);
const addQuery = ref("");
const picked = ref(new Set<string>());

const addCandidates = computed(() => {
  const inGroup = new Set(members.value.map((m) => m.user.id));
  const q = addQuery.value.trim().toLowerCase();
  return contacts.list.filter(
    (c) =>
      !inGroup.has(c.user.id) &&
      (!q || c.user.displayName.toLowerCase().includes(q) || c.user.tag.toLowerCase().includes(q)),
  );
});

function togglePick(id: string) {
  if (picked.value.has(id)) picked.value.delete(id);
  else picked.value.add(id);
}

async function addPicked() {
  if (!picked.value.size) return;
  busy.value = true;
  try {
    await chats.addGroupMembers(chatId, [...picked.value]);
    addMode.value = false;
    picked.value = new Set();
    addQuery.value = "";
  } catch {
    pageError.value = "only contacts can be added";
  } finally {
    busy.value = false;
  }
}

// ---- title edit ----
const editingTitle = ref(false);
const titleDraft = ref("");

async function saveTitle() {
  const t = titleDraft.value.trim();
  if (!t || t === chat.value?.title) {
    editingTitle.value = false;
    return;
  }
  busy.value = true;
  try {
    await chats.renameGroup(chatId, t);
    editingTitle.value = false;
  } catch {
    pageError.value = "could not rename";
  } finally {
    busy.value = false;
  }
}

const loadError = ref("");
onMounted(async () => {
  try {
    await Promise.all([chats.openChat(chatId), contacts.loaded ? Promise.resolve() : contacts.refresh()]);
  } catch (e) {
    loadError.value = e instanceof ApiRequestError && e.status === 404 ? "group not found" : "failed to load";
  }
});
</script>

<template>
  <main class="flex h-dvh flex-col overflow-hidden">
    <div class="flex items-center gap-3 px-6 pb-4 pt-8">
      <button
        class="grid size-10 shrink-0 place-items-center text-ink"
        aria-label="back"
        @click="router.push({ name: 's5-chat-view', params: { chatId } })"
      >
        <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.25">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <div class="min-w-0 flex-1">
        <div class="truncate text-name text-ink" data-testid="group-title">{{ chat?.title ?? "group" }}</div>
        <div class="text-meta text-muted" data-testid="member-count">
          {{ members.length }} {{ members.length === 1 ? "member" : "members" }}
        </div>
      </div>
    </div>

    <div v-if="loadError" class="grid flex-1 place-items-center text-meta text-muted">{{ loadError }}</div>

    <div v-else class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="pageError" class="px-6 py-2 text-meta text-danger" data-testid="page-error">
        {{ pageError }}
      </div>
      <div class="px-6 pb-1 pt-2 text-meta text-muted">members</div>
      <UserRow
        v-for="m in members"
        :key="m.user.id"
        :user="m.user"
        :subtitle="(m.user.id === session.user?.id ? 'you' : rightLabel(m)) || undefined"
        data-testid="member-row"
        @open="onMemberTap(m)"
      />
      <button
        v-if="canInvite"
        class="flex w-full items-center gap-3 px-6 py-3 text-left text-accent"
        data-testid="add-member"
        @click="addMode = true"
      >
        <span class="grid size-10 place-items-center rounded-full border border-line text-lg">+</span>
        <span class="text-name">add member</span>
      </button>

      <div class="mt-4 px-6 pb-1 text-meta text-muted">group</div>
      <button
        v-if="canEditInfo"
        class="w-full px-6 py-3 text-left text-name text-ink"
        data-testid="edit-name"
        @click="((editingTitle = true), (titleDraft = chat?.title ?? ''))"
      >
        edit name
      </button>
      <button
        class="w-full px-6 py-3 text-left text-name text-danger"
        data-testid="leave-group"
        @click="confirmKind = 'leave'"
      >
        leave group
      </button>
    </div>

    <!-- title editor -->
    <div v-if="editingTitle" class="border-t border-line px-6 py-4">
      <AppInput v-model="titleDraft" label="group name" placeholder="group name" maxlength="128" />
      <div class="mt-2 flex gap-2">
        <AppButton :loading="busy" data-testid="title-save" @click="saveTitle">save</AppButton>
        <button class="text-muted" @click="editingTitle = false">cancel</button>
      </div>
    </div>

    <!-- add member picker -->
    <div v-if="addMode" class="fixed inset-0 z-40 flex flex-col bg-bg">
      <div class="flex items-center gap-3 px-6 pb-4 pt-8">
        <button class="grid size-10 shrink-0 place-items-center text-ink" aria-label="close picker" @click="addMode = false">
          <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.25">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <div class="text-name text-ink">add members</div>
      </div>
      <div class="px-6 pb-3">
        <div class="flex items-center gap-2 rounded-input bg-canvas px-3 py-2">
          <input
            v-model="addQuery"
            class="w-full bg-transparent text-msg outline-none placeholder:text-muted"
            placeholder="search contacts"
            data-testid="add-query"
          />
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <UserRow
          v-for="c in addCandidates"
          :key="c.user.id"
          :user="c.user"
          :subtitle="c.user.tag"
          data-testid="add-row"
          @open="togglePick(c.user.id)"
        >
          <span
            class="grid size-6 place-items-center rounded-full border text-micro"
            :class="picked.has(c.user.id) ? 'border-ink bg-ink text-bg' : 'border-line text-transparent'"
          >✓</span>
        </UserRow>
        <div v-if="!addCandidates.length" class="px-6 py-8 text-center text-meta text-muted">
          everyone is already here
        </div>
      </div>
      <div class="px-6 py-4">
        <AppButton :disabled="!picked.size" :loading="busy" data-testid="add-confirm" @click="addPicked">
          add {{ picked.size ? `(${picked.size})` : "" }}
        </AppButton>
      </div>
    </div>

    <!-- member action sheet -->
    <div
      v-if="sheet"
      class="fixed inset-0 z-50 flex items-end justify-center bg-ink/30"
      data-testid="member-sheet"
      @click.self="sheet = null"
    >
      <div class="w-full max-w-md rounded-t-card bg-bg p-6 pb-8">
        <div class="flex items-center gap-3">
          <span class="grid size-10 place-items-center rounded-full bg-bubble-in text-name text-muted">
            {{ sheet.user.displayName.slice(0, 1) }}
          </span>
          <div class="min-w-0">
            <div class="truncate text-name text-ink">{{ sheet.user.displayName }}</div>
            <div class="text-meta text-muted">{{ sheet.user.tag }}</div>
          </div>
        </div>

        <div v-if="isOwner && sheet.role !== 'owner'" class="mt-4">
          <div class="mb-2 text-meta text-muted">permissions</div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="[key, label] in RIGHT_KEYS"
              :key="key"
              class="rounded-pill border px-3 py-1 text-meta"
              :class="sheet.rights?.[key] ? 'border-ink bg-ink text-bg' : 'border-line text-muted'"
              :disabled="busy"
              :data-testid="`right-${key}`"
              @click="toggleRight(sheet, key)"
            >
              {{ label }}
            </button>
          </div>
        </div>

        <div class="mt-4 flex flex-col">
          <button
            v-if="isOwner && sheet.role !== 'owner'"
            class="py-2 text-left text-name text-ink"
            data-testid="transfer"
            @click="((confirmKind = 'transfer'), (confirmMember = sheet), (sheet = null))"
          >
            transfer ownership
          </button>
          <button
            v-if="canRemove && sheet.role !== 'owner'"
            class="py-2 text-left text-name text-danger"
            data-testid="remove-member"
            @click="((confirmKind = 'remove'), (confirmMember = sheet), (sheet = null))"
          >
            remove from group
          </button>
          <button class="py-2 text-left text-name text-muted" @click="sheet = null">close</button>
        </div>
        <div v-if="sheetError" class="mt-2 text-meta text-danger" data-testid="sheet-error">{{ sheetError }}</div>
      </div>
    </div>

    <ConfirmDialog
      v-if="confirmKind"
      :title="confirmCopy.title"
      :body="confirmCopy.body"
      :confirm-label="confirmCopy.action"
      :busy="busy"
      data-testid="confirm-dialog"
      @confirm="confirmAction"
      @cancel="((confirmKind = null), (confirmMember = null))"
    />
  </main>
</template>
