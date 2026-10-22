// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Contacts store — consent model. `list` holds ACCEPTED (mutual) contacts
// only; pending requests live in `incoming` / `outgoing`. REST for state,
// WS for deltas. Decline is silent: a declined outgoing request stays in
// `outgoing` (the server never tells the requester), and the target's
// other devices learn through contact.request.resolved.

import { defineStore } from "pinia";

import { ApiRequestError } from "../api/client";
import type { Contact, ContactRequest, ContactRequestResult, User } from "../api/client";
import { api } from "./session";

export const useContactsStore = defineStore("contacts", {
  state: () => ({
    /** accepted contacts (always mutual) */
    list: [] as Contact[],
    /** requests addressed to me — Accept / Decline */
    incoming: [] as ContactRequest[],
    /** requests I sent — Resend / Cancel */
    outgoing: [] as ContactRequest[],
    loaded: false,
    loading: false,
  }),

  getters: {
    byId: (s) => (userId: string): Contact | undefined =>
      s.list.find((c) => c.user.id === userId),
    isContact(): (userId?: string) => boolean {
      return (userId) => !!userId && !!this.byId(userId);
    },
    /** Contacts are mutual by construction; kept for call-site clarity. */
    isMutual(): (userId?: string) => boolean {
      return (userId) => this.isContact(userId);
    },
    hasOutgoing: (s) => (userId?: string) => !!userId && s.outgoing.some((r) => r.user.id === userId),
    hasIncoming: (s) => (userId?: string) => !!userId && s.incoming.some((r) => r.user.id === userId),
    contactIds: (s) => s.list.map((c) => c.user.id),
    /** Mutuals can open direct chats — the S8 member picker feed. */
    mutualContacts: (s) => s.list,
    /** Tab/header badge: requests waiting for my answer. */
    requestCount: (s) => s.incoming.length,
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
            (c.user.displayName ?? "").toLowerCase().includes(needle) ||
            (c.user.tag ?? "").toLowerCase().includes(needle),
        );
      },
  },

  actions: {
    /** First load + revalidation after resync.required. */
    async refresh() {
      if (this.loading) return;
      this.loading = true;
      try {
        const [{ contacts }, { incoming, outgoing }] = await Promise.all([
          api().contacts.list(),
          api().contacts.listRequests(),
        ]);
        this.list = contacts;
        this.incoming = incoming;
        this.outgoing = outgoing;
        this.loaded = true;
      } finally {
        this.loading = false;
      }
    },

    /** Send a request. A pending reverse request collapses into a contact. */
    async sendRequest(userId: string): Promise<ContactRequestResult> {
      if (this.isContact(userId)) return { relationship: "contact_mutual", contact: this.byId(userId) };
      const res = await api().contacts.request(userId);
      if (res.relationship === "contact_mutual" && res.contact) {
        this.addContact(res.contact);
        this.incoming = this.incoming.filter((r) => r.user.id !== userId);
      } else if (res.request && !this.hasOutgoing(userId)) {
        this.outgoing.unshift(res.request);
      }
      return res;
    },

    async accept(userId: string): Promise<Contact> {
      const { contact } = await api().contacts.acceptRequest(userId);
      this.addContact(contact);
      this.incoming = this.incoming.filter((r) => r.user.id !== userId);
      return contact;
    },

    async decline(userId: string) {
      await api().contacts.declineRequest(userId);
      this.incoming = this.incoming.filter((r) => r.user.id !== userId);
    },

    async cancel(userId: string) {
      await api().contacts.cancelRequest(userId);
      this.outgoing = this.outgoing.filter((r) => r.user.id !== userId);
    },

    async remove(userId: string) {
      try {
        await api().contacts.remove(userId);
      } catch (e) {
        if (!(e instanceof ApiRequestError && e.status === 404)) throw e; // already gone
      }
      this.list = this.list.filter((c) => c.user.id !== userId);
    },

    addContact(contact: Contact) {
      if (!this.byId(contact.user.id)) this.list.push(contact);
    },

    // ---------- ws deltas ----------

    /** Someone asked to connect — shows up in my incoming list. */
    onContactRequest(user: User, createdAt: string) {
      if (!this.hasIncoming(user.id)) this.incoming.unshift({ user, createdAt });
    },

    /** A request between me and `user` was accepted (either direction). */
    onContactAccepted(user: User) {
      this.addContact({ user, mutual: true, addedAt: new Date().toISOString(), verifiedAt: null });
      this.incoming = this.incoming.filter((r) => r.user.id !== user.id);
      this.outgoing = this.outgoing.filter((r) => r.user.id !== user.id);
    },

    /** The requester cancelled. */
    onRequestWithdrawn(userId: string) {
      this.incoming = this.incoming.filter((r) => r.user.id !== userId);
    },

    /** Resolved on another of my devices — clear it from both lists. */
    onRequestResolved(userId: string) {
      this.incoming = this.incoming.filter((r) => r.user.id !== userId);
      this.outgoing = this.outgoing.filter((r) => r.user.id !== userId);
    },

    /** The contact was removed (by me elsewhere, or by them). */
    onContactRemoved(userId: string) {
      this.list = this.list.filter((c) => c.user.id !== userId);
    },

    /** Profile edit by a mutual — patch the cached User on the contact. */
    onUserUpdated(user: User) {
      const c = this.byId(user.id);
      if (c) c.user = user;
    },
  },
});
