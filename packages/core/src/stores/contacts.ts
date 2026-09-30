// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Contacts store — the outgoing contact list with mutual flags.
// REST for state, WS for deltas: contact.added/removed arrive at the
// *target* side, so they only flip the mutual flag on an existing
// outgoing edge — the list itself changes solely via add()/remove().
// Incoming-only contacts have no list API; relationship badges read
// users.get(userId).relationship instead (S7).

import { defineStore } from "pinia";

import type { Contact, User } from "../api/client";
import { api } from "./session";

export const useContactsStore = defineStore("contacts", {
  state: () => ({
    list: [] as Contact[],
    loaded: false,
    loading: false,
  }),

  getters: {
    byId: (s) => (userId: string): Contact | undefined =>
      s.list.find((c) => c.user.id === userId),
    isContact(): (userId?: string) => boolean {
      return (userId) => !!userId && !!this.byId(userId);
    },
    isMutual(): (userId?: string) => boolean {
      return (userId) => !!userId && !!this.byId(userId)?.mutual;
    },
    contactIds: (s) => s.list.map((c) => c.user.id),
    /** Mutuals can open direct chats — the S8 member picker feed. */
    mutualContacts: (s) => s.list.filter((c) => c.mutual),
    /**
     * Local filter for the S6 "contacts" section — substring match on
     * displayName or tag, case-insensitive. The "global" section is a
     * separate server search; this only narrows the loaded roster.
     */
    searchLocal:
      (s) =>
      (q: string): Contact[] => {
        const needle = q.trim().toLowerCase();
        if (!needle) return s.list;
        return s.list.filter(
          (c) =>
            c.user.displayName.toLowerCase().includes(needle) ||
            c.user.tag.toLowerCase().includes(needle),
        );
      },
  },

  actions: {
    /** First load + revalidation after resync.required. */
    async refresh() {
      if (this.loading) return;
      this.loading = true;
      try {
        const { contacts } = await api().contacts.list();
        this.list = contacts;
        this.loaded = true;
      } finally {
        this.loading = false;
      }
    },

    async add(userId: string): Promise<Contact> {
      const existing = this.byId(userId);
      if (existing) return existing; // idempotent — 409 is an already-there
      const { contact } = await api().contacts.add(userId);
      this.list.push(contact);
      return contact;
    },

    async remove(userId: string) {
      await api().contacts.remove(userId);
      this.list = this.list.filter((c) => c.user.id !== userId);
    },

    // ---------- ws deltas (target-side semantics) ----------

    /** Someone added me — my outgoing edge to them (if any) is now mutual. */
    onContactAdded(user: User) {
      const c = this.byId(user.id);
      if (c) c.mutual = true;
    },

    /** Someone removed me — my edge stays, the mutual flag drops. */
    onContactRemoved(userId: string) {
      const c = this.byId(userId);
      if (c) c.mutual = false;
    },

    /** Profile edit by a mutual — patch the cached User on the contact. */
    onUserUpdated(user: User) {
      const c = this.byId(user.id);
      if (c) c.user = user;
    },
  },
});
