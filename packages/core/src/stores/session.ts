// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Session store — auth state and the S1→S4 flow. Wraps api.auth.*;
// holds tokens in memory + mirrors to localStorage so a demo session
// survives reloads (mock tokens never expire; real refresh rotation
// lands with the backend, #12+).

import { defineStore } from "pinia";

import type { ApiClient, User } from "../api/client";

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

    async logout() {
      try {
        await api().auth.logout();
      } finally {
        this.$reset();
        savePersisted(null);
        api().setAccessToken(null);
      }
    },
  },
});
