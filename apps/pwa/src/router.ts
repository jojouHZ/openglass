// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { createRouter, createWebHistory } from "vue-router";
import type { Router, RouteRecordRaw, RouterHistory } from "vue-router";

import { useSessionStore } from "@openglass/core";

import { pinia } from "./pinia";

// Screen IDs come from docs/ux/flows.md — one route per screen.

const Placeholder = () => import("./views/_PlaceholderView.vue");

export const routes: RouteRecordRaw[] = [
  { path: "/", name: "s0-entry", redirect: { name: "s4-chat-list" }, meta: { screen: "S0" } },
  { path: "/invite", name: "s1-invite", component: () => import("./views/S1InviteEmail.vue"), meta: { screen: "S1" } },
  { path: "/otp", name: "s2-otp", component: () => import("./views/S2Otp.vue"), meta: { screen: "S2" } },
  { path: "/setup", name: "s3-profile-setup", component: () => import("./views/S3ProfileSetup.vue"), meta: { screen: "S3" } },
  { path: "/chats", name: "s4-chat-list", component: () => import("./views/S4ChatList.vue"), meta: { screen: "S4", auth: true } },
  { path: "/chats/:chatId", name: "s5-chat-view", component: () => import("./views/S5ChatView.vue"), meta: { screen: "S5", auth: true } },
  { path: "/search", name: "s6-contact-search", component: () => import("./views/S6ContactSearch.vue"), meta: { screen: "S6", auth: true } },
  { path: "/contacts/:userId", name: "s7-contact-profile", component: () => import("./views/S7ContactProfile.vue"), meta: { screen: "S7", auth: true } },
  { path: "/groups/new", name: "s8-group-create", component: () => import("./views/S8GroupCreate.vue"), meta: { screen: "S8", auth: true } },
  { path: "/groups/:chatId", name: "s9-group", component: Placeholder, meta: { screen: "S9", auth: true } },
  { path: "/groups/:chatId/manage", name: "s9a-group-manage", component: Placeholder, meta: { screen: "S9a", auth: true } },
  { path: "/settings", name: "s13-settings", component: Placeholder, meta: { screen: "S13", auth: true } },
  { path: "/settings/security", name: "s14-security", component: Placeholder, meta: { screen: "S14", auth: true } },
  { path: "/pwa", name: "s15-pwa", component: Placeholder, meta: { screen: "S15" } },
  { path: "/states", name: "s16-states", component: Placeholder, meta: { screen: "S16" } },
];

// Private-layer screens S10–S12 exist ONLY in the pwa-dev build
// (VITE_PRIVATE_MODULE=1). The pwa-mvp bundle must not contain the
// private module — dynamic imports keep it out of the chunk graph.
if (import.meta.env.VITE_PRIVATE_MODULE === "1") {
  routes.push(
    {
      path: "/chats/:chatId/private/invite",
      name: "s10-private-invite",
      component: () => import("./views/private/S10PrivateInvite.vue"),
      meta: { screen: "S10", private: true, auth: true },
    },
    {
      path: "/chats/:chatId/private/setup",
      name: "s11-session-setup",
      component: () => import("./views/private/S11SessionSetup.vue"),
      meta: { screen: "S11", private: true, auth: true },
    },
    {
      path: "/chats/:chatId/private/verify",
      name: "s11b-verify",
      component: () => import("./views/private/S11bVerify.vue"),
      meta: { screen: "S11b", private: true, auth: true },
    },
    {
      path: "/chats/:chatId/private",
      name: "s12-private-chat",
      component: () => import("./views/private/S12PrivateChat.vue"),
      meta: { screen: "S12", private: true, auth: true },
    },
  );
}

const AUTH_FLOW = new Set(["s0-entry", "s1-invite", "s2-otp", "s3-profile-setup"]);

/** Router factory — memory history for tests, web history for the app. */
export function createAppRouter(history?: RouterHistory): Router {
  const router = createRouter({
    history: history ?? createWebHistory(),
    routes,
  });

  router.beforeEach((to) => {
    const session = useSessionStore(pinia);
    if (!session.hydrated) session.hydrate();

    if (session.authed && AUTH_FLOW.has(String(to.name))) {
      return { name: "s4-chat-list" };
    }
    if (to.meta.auth && !session.authed) {
      return { name: "s1-invite" };
    }
    // mid-flow gates: S2 needs a pending email, S3 needs needsProfile
    if (to.name === "s2-otp" && !session.authed && !session.pendingEmail) {
      return { name: "s1-invite" };
    }
    if (to.name === "s3-profile-setup" && !session.authed && !session.needsProfile) {
      return { name: "s1-invite" };
    }
    return true;
  });

  return router;
}

export const router = createAppRouter();
