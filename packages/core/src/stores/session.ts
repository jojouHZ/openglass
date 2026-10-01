// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Session store — auth state and the S1→S4 flow. Wraps api.auth.*;
// holds tokens in memory + mirrors to localStorage so a demo session
// survives reloads (mock tokens never expire; real refresh rotation
// lands with the backend, #12+).

import { defineStore } from "pinia";

import type { ApiClient, DeviceSession, User } from "../api/client";
import { useChatsStore } from "./chats";

let apiRef: ApiClient | null = null;

/** Called once at app bootstrap — the store talks to the bound client. */
export function bindApiClient(api: ApiClient): void {
  apiRef = api;
}

/** The bound ApiClient — shared by all core stores. */
export function api(): ApiClient {
  if (!apiRef) throw new Error("api client not bound — call bindApiClient()");
  return apiRef;
}

const STORAGE_KEY = "og.session";

interface PersistedSession {
  accessToken: string;
  refreshToken: string;
  user: User;
  email: string;
}

function loadPersisted(): PersistedSession | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedSession) : null;
  } catch {
    return null;
  }
}

function savePersisted(s: PersistedSession | null): void {
  if (typeof localStorage === "undefined") return;
  if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  else localStorage.removeItem(STORAGE_KEY);
}

export const useSessionStore = defineStore("session", {
  state: () => ({
    hydrated: false,
    accessToken: null as string | null,
    refreshToken: null as string | null,
    user: null as User | null,
    email: null as string | null,
    /** Set by S1 — the email the OTP was sent to. */
    pendingEmail: null as string | null,
    /** verifyOtp said the account has no profile yet. */
    needsProfile: false,
    /** resendAvailableInS echoed from the last requestOtp. */
    resendCooldownS: 0,
    /** S14 — sessions of this account (own device included). */
    sessions: [] as DeviceSession[],
  }),
  getters: {
    authed: (s) => s.user !== null,
  },
  actions: {
    /** Restore persisted session — call once before first navigation. */
    hydrate() {
      const p = loadPersisted();
      if (p) {
        this.accessToken = p.accessToken;
        this.refreshToken = p.refreshToken;
        this.user = p.user;
        this.email = p.email;
        api().setAccessToken(p.accessToken);
      }
      this.hydrated = true;
    },

    async requestOtp(email: string, inviteCode?: string) {
      const r = await api().auth.requestOtp({ email, inviteCode });
      this.pendingEmail = email;
      this.resendCooldownS = r.resendAvailableInS;
      return r;
    },

    async verifyOtp(code: string, deviceName: string) {
      if (!this.pendingEmail) throw new Error("no pending email — start at S1");
      const r = await api().auth.verifyOtp({
        email: this.pendingEmail,
        code,
        deviceName,
      });
      this.accessToken = r.accessToken;
      this.refreshToken = r.refreshToken;
      this.needsProfile = r.needsProfile;
      api().setAccessToken(r.accessToken);
      if (r.user) {
        this.user = r.user;
        this.email = this.pendingEmail;
        savePersisted({
          accessToken: r.accessToken,
          refreshToken: r.refreshToken,
          user: r.user,
          email: this.pendingEmail,
        });
      }
      return r;
    },

    async completeProfile(displayName: string, requestedTag?: string) {
      const { user } = await api().auth.completeProfile({ displayName, requestedTag });
      this.user = user;
      this.needsProfile = false;
      this.email = this.pendingEmail;
      if (this.accessToken && this.refreshToken && this.email) {
        savePersisted({
          accessToken: this.accessToken,
          refreshToken: this.refreshToken,
          user,
          email: this.email,
        });
      }
      return user;
    },

    /** Rotate the token pair — WS reconnect and future 401-retry use this. */
    async refreshTokens() {
      if (!this.refreshToken) throw new Error("no refresh token");
      const r = await api().auth.refresh(this.refreshToken);
      this.accessToken = r.accessToken;
      this.refreshToken = r.refreshToken;
      api().setAccessToken(r.accessToken);
      if (this.user && this.email) {
        savePersisted({
          accessToken: r.accessToken,
          refreshToken: r.refreshToken,
          user: this.user,
          email: this.email,
        });
      }
      return r;
    },

    /** S13 — rename via users.updateMe; persists the fresh user. */
    async updateProfile(displayName: string) {
      const { user } = await api().users.updateMe({ displayName });
      this.user = user;
      if (this.accessToken && this.refreshToken && this.email) {
        savePersisted({
          accessToken: this.accessToken,
          refreshToken: this.refreshToken,
          user,
          email: this.email,
        });
      }
      return user;
    },

    /** S14 */
    async refreshSessions() {
      const { sessions } = await api().auth.listSessions();
      this.sessions = sessions;
    },

    /** Revoke a non-current session; the current row is never removable. */
    async revokeSession(sessionId: string) {
      await api().auth.revokeSession(sessionId);
      this.sessions = this.sessions.filter((s) => s.id !== sessionId);
    },

    /** Revoke every session except the current device. */
    async revokeOtherSessions() {
      for (const s of this.sessions.filter((x) => !x.current)) {
        await api().auth.revokeSession(s.id);
      }
      this.sessions = this.sessions.filter((s) => s.current);
    },

    async logout() {
      try {
        // purge chats/contacts state before the session resets —
        // a second account must never see the previous owner's data
        useChatsStore().teardown();
        await api().auth.logout();
      } finally {
        this.$reset();
        savePersisted(null);
        api().setAccessToken(null);
      }
    },
  },
});
