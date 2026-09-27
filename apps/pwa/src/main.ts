// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { createPinia } from "pinia";
import { createApp } from "vue";

import { createApiClient } from "@openglass/core";

import App from "./App.vue";
import { ApiClientKey } from "./provide";
import { router } from "./router";
import "./styles/tokens.css";

async function bootstrap() {
  const api = await createApiClient({
    mode: import.meta.env.VITE_API_MODE ?? "mock",
    baseUrl: "/api/v1",
    wsUrl: "/api/v1/ws",
    privateModule: import.meta.env.VITE_PRIVATE_MODULE === "1",
  }).catch((err: unknown) => {
    // Mock lands in #9 — until then the app boots without an API client
    // so the scaffold can render placeholders.
    console.warn("[openglass] api client unavailable:", err);
    return null;
  });

  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  if (api) app.provide(ApiClientKey, api);
  app.mount("#app");
}

void bootstrap();
