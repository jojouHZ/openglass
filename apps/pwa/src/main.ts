// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { createApp } from "vue";

import { bindApiClient, createApiClient } from "@openglass/core";

import App from "./App.vue";
import { pinia } from "./pinia";
import { ApiClientKey } from "./provide";
import { createAppRouter } from "./router";
import "./styles/tokens.css";

async function bootstrap() {
  const api = await createApiClient({
    mode: import.meta.env.VITE_API_MODE ?? "mock",
    baseUrl: "/api/v1",
    wsUrl: "/api/v1/ws",
    privateModule: import.meta.env.VITE_PRIVATE_MODULE === "1",
  });
  bindApiClient(api);

  const app = createApp(App);
  app.use(pinia);
  app.use(createAppRouter());
  app.provide(ApiClientKey, api);
  app.mount("#app");
}

void bootstrap();
