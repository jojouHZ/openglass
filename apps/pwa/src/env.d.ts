// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** mock = MSW + fixtures; live = real backend */
  readonly VITE_API_MODE?: "mock" | "live";
  /** pwa-dev demo host only — enables the private remote module */
  readonly VITE_PRIVATE_MODULE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
