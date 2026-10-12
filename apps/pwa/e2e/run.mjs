// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Playwright webServer wrapper: starts the in-memory Go E2E backend on a
// free port, seeds two users, then starts the pwa-dev Vite server proxied
// to that backend. Kills both on SIGTERM/SIGINT.

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pwaRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(__dirname, "../../..");
const stateFile = path.join(pwaRoot, "e2e/.e2e-state.json");

function findGo() {
  if (process.env.GO_BINARY) return process.env.GO_BINARY;
  const candidates = [
    process.env.GOROOT ? path.join(process.env.GOROOT, "bin/go") : "",
    path.join(process.env.HOME ?? "/", "sdk/go/bin/go"),
    "/usr/local/go/bin/go",
    "/opt/go/bin/go",
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return "go";
}

const children = [];

function cleanup() {
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
  }
  // give them a moment, then SIGKILL
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        try {
          child.kill("SIGKILL");
        } catch {}
      }
    }
    process.exit(0);
  }, 1000);
}

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);

function waitForLine(child, marker) {
  return new Promise((resolve, reject) => {
    const onData = (data) => {
      const chunk = data.toString();
      if (chunk.includes(marker)) {
        child.stdout.off("data", onData);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`process exited with code ${code}`));
      }
    });
  });
}

async function waitForURL(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.status === 200 || res.status === 404) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for ${url}`);
}

const goBin = findGo();
const goArgs =
  path.basename(goBin) === "go"
    ? ["run", "./cmd/e2e-server", "-state", stateFile]
    : ["-state", stateFile];
const go = spawn(
  goBin,
  goArgs,
  {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
children.push(go);
go.stderr.pipe(process.stderr);

await waitForLine(go, "E2E_SERVER_READY");
const seed = JSON.parse(readFileSync(stateFile, "utf8"));
console.log("[e2e runner] backend ready at", seed.apiUrl);

const vite = spawn(
  "pnpm",
  ["exec", "vite", "--mode", "pwa-dev", "--port", "5174", "--strictPort"],
  {
    cwd: pwaRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      OPENCGLASS_API_URL: seed.apiUrl,
    },
  },
);
children.push(vite);
vite.stderr.pipe(process.stderr);

await waitForURL("http://127.0.0.1:5174/", 60000);
console.log("[e2e runner] pwa-dev ready at http://127.0.0.1:5174/");

// keep the wrapper alive so Playwright can attach and later SIGTERM us
await new Promise(() => {});
