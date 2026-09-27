// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { createRouter, createWebHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";

// Screen IDs come from docs/ux/flows.md — one route per screen.

const Placeholder = () => import("./views/_PlaceholderView.vue");

const routes: RouteRecordRaw[] = [
  { path: "/", name: "s0-entry", component: Placeholder, meta: { screen: "S0" } },
  { path: "/invite", name: "s1-invite", component: Placeholder, meta: { screen: "S1" } },
  { path: "/otp", name: "s2-otp", component: Placeholder, meta: { screen: "S2" } },
  { path: "/setup", name: "s3-profile-setup", component: Placeholder, meta: { screen: "S3" } },
  { path: "/chats", name: "s4-chat-list", component: Placeholder, meta: { screen: "S4" } },
  { path: "/chats/:chatId", name: "s5-chat-view", component: Placeholder, meta: { screen: "S5" } },
  { path: "/search", name: "s6-contact-search", component: Placeholder, meta: { screen: "S6" } },
  { path: "/contacts/:userId", name: "s7-contact-profile", component: Placeholder, meta: { screen: "S7" } },
  { path: "/groups/new", name: "s8-group-create", component: Placeholder, meta: { screen: "S8" } },
  { path: "/groups/:chatId", name: "s9-group", component: Placeholder, meta: { screen: "S9" } },
  { path: "/groups/:chatId/manage", name: "s9a-group-manage", component: Placeholder, meta: { screen: "S9a" } },
  { path: "/settings", name: "s13-settings", component: Placeholder, meta: { screen: "S13" } },
  { path: "/settings/security", name: "s14-security", component: Placeholder, meta: { screen: "S14" } },
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
      meta: { screen: "S10", private: true },
    },
    {
      path: "/chats/:chatId/private/setup",
      name: "s11-session-setup",
      component: () => import("./views/private/S11SessionSetup.vue"),
      meta: { screen: "S11", private: true },
    },
    {
      path: "/chats/:chatId/private/verify",
      name: "s11b-verify",
      component: () => import("./views/private/S11bVerify.vue"),
      meta: { screen: "S11b", private: true },
    },
    {
      path: "/chats/:chatId/private",
      name: "s12-private-chat",
      component: () => import("./views/private/S12PrivateChat.vue"),
      meta: { screen: "S12", private: true },
    },
  );
}

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
