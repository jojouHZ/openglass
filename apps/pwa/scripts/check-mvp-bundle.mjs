// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// MVP bundle guard: the production pwa-mvp build must contain no
// private-layer code. Private views live under src/views/private/ and are
// dynamically imported only when VITE_PRIVATE_MODULE=1 — in the mvp build
// that branch is statically dead, so no private chunk may exist in dist.
//
// Fails (exit 1) if any dist asset looks like a private-module artifact.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = new URL("../dist/assets", import.meta.url).pathname;
const MARKERS = [
  /S1[012][A-Z]/, // S10PrivateInvite / S11SessionSetup / S11bVerify / S12PrivateChat chunks
  /openglass-private/, // dev-tier IndexedDB name must never ship
  /relay\.(invite|accept|send|resume|burn)/, // relay protocol strings
];

let bad = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    const hitName = MARKERS.find((m) => m.test(name));
    if (hitName) bad.push(`${p} (filename matches ${hitName})`);
    if (/\.(js|mjs|map)$/.test(name)) {
      const text = readFileSync(p, "utf8");
      const hitBody = MARKERS.find((m) => m.test(text));
      if (hitBody) bad.push(`${p} (content matches ${hitBody})`);
    }
  }
}

try {
  walk(dist);
} catch {
  console.error(`check-mvp-bundle: ${dist} not found — run \`pnpm build\` first`);
  process.exit(1);
}

if (bad.length) {
  console.error("check-mvp-bundle: private-layer artifacts found in the mvp bundle:");
  for (const b of bad) console.error(`  ${b}`);
  process.exit(1);
}
console.log("check-mvp-bundle: clean — no private-layer artifacts in dist");
