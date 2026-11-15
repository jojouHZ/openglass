// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { defineConfig } from "vitest/config";

import viteConfig from "./vite.config";

export default defineConfig({
  ...viteConfig,
  test: {
    setupFiles: ["./src/test-setup.ts"],
    // headroom for slow machines; fast tests are unaffected
    testTimeout: 15000,
    // each happy-dom worker holds a few hundred MB; one worker per core
    // swaps on a small-RAM host and makes timing-based assertions flaky
    maxWorkers: 4,
    // Real-browser E2E specs live in e2e/ and are driven by Playwright,
    // not by the unit-test runner.
    exclude: ["**/e2e/**", "**/node_modules/**", "**/dist/**"],
  },
});
