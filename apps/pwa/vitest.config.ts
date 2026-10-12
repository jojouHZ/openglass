// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { defineConfig } from "vitest/config";

import viteConfig from "./vite.config";

export default defineConfig({
  ...viteConfig,
  test: {
    // Real-browser E2E specs live in e2e/ and are driven by Playwright,
    // not by the unit-test runner.
    exclude: ["**/e2e/**", "**/node_modules/**", "**/dist/**"],
  },
});
