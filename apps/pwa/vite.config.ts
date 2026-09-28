// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// Backend skeleton serves /api/v1 on :8081 (TEI embedder owns :8080).
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      // deep imports first — bare "@openglass/core" maps to index.ts
      {
        find: /^@openglass\/core\/(.*)$/,
        replacement: fileURLToPath(new URL("../../packages/core/src/$1", import.meta.url)),
      },
      {
        find: /^@openglass\/core$/,
        replacement: fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8081",
        changeOrigin: true,
        ws: true,
      },
      "/healthz": {
        target: "http://127.0.0.1:8081",
        changeOrigin: true,
      },
    },
  },
});
