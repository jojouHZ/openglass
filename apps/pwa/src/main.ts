// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { createApp } from "vue";

import {
  bindApiClient,
  createApiClient,
  useChatsStore,
  useSessionStore,
} from "@openglass/core";

import App from "./App.vue";
import { pinia } from "./pinia";
import { initInstallPrompt } from "./pwa/install";
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
  initInstallPrompt();

  const app = createApp(App);
  app.use(pinia);

  // Restored session → reopen realtime (fresh sessions connect on S4 mount)
  const session = useSessionStore(pinia);
  session.hydrate();
  if (session.authed) {
    void useChatsStore(pinia).connectRealtime().catch(() => undefined);
  }

  // Private layer — pwa-dev only (VITE_PRIVATE_MODULE=1). The dynamic
  // import is behind a statically-replaced flag so the mvp bundle drops
  // this branch entirely; zero-trace teardown on logout + pagehide.
  if (import.meta.env.VITE_PRIVATE_MODULE === "1") {
    const { usePrivateStore } = await import("@openglass/core/private/store");
    const { wirePrivateLifecycle } = await import("./privateBoot");
    const priv = usePrivateStore(pinia);
    priv.boot("/api/v1/relay", () => session.accessToken);
    wirePrivateLifecycle(priv, session);
  }

  app.use(createAppRouter());
  app.provide(ApiClientKey, api);
  app.mount("#app");

  // App SW only in live production builds — mock mode is served by MSW's
  // own worker, and dev doesn't need the cache.
  if (
    import.meta.env.PROD &&
    import.meta.env.VITE_API_MODE !== "mock" &&
    "serviceWorker" in navigator
  ) {
    void navigator.serviceWorker.register("/sw.js");
  }
}

void bootstrap();
