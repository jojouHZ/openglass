// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// The app service worker (public/sw.js) run in a sandbox with a fake Cache API
// (plain .mjs: it reads the script from disk with node:fs). Contract: the shell
// works offline — including the pre-paint theme script — and no API payload is
// ever cached.

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

function boot({ online = true } = {}) {
  const store = new Map(); // cacheName -> Map(url -> Response-like)
  const listeners = {};
  const fetched = [];
  const mk = (url, body) => ({ url, body, clone() { return this; } });
  const caches = {
    async open(name) {
      if (!store.has(name)) store.set(name, new Map());
      const c = store.get(name);
      return {
        async add(u) { c.set(new URL(u, "https://app.test").pathname, mk(u, "fetched:" + u)); },
        async addAll(us) { for (const u of us) await this.add(u); },
        async put(k, res) { c.set(typeof k === "string" ? k : new URL(k.url).pathname, res); },
        async keys() { return [...c.keys()].map((p) => ({ url: "https://app.test" + p })); },
        async delete(k) { return c.delete(typeof k === "string" ? k : new URL(k.url).pathname); },
      };
    },
    async keys() { return [...store.keys()]; },
    async delete(n) { return store.delete(n); },
    async match(req) {
      const key = typeof req === "string" ? req : new URL(req.url).pathname;
      for (const c of store.values()) if (c.has(key)) return c.get(key);
      return undefined;
    },
  };
  const self = {
    location: { origin: "https://app.test" },
    addEventListener: (t, fn) => (listeners[t] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  runInNewContext(source, {
    self, caches, URL,
    fetch: async (req) => {
      fetched.push(new URL(req.url).pathname);
      if (!online) throw new Error("offline");
      return mk(req.url, "network:" + req.url);
    },
  });
  const run = async (type, extra = {}) => {
    let p;
    listeners[type]({ ...extra, waitUntil: (x) => (p = x), respondWith: (x) => (p = x) });
    return p;
  };
  return { store, run, fetched, setOnline: (v) => (online = v) };
}

const req = (path, extra = {}) => ({ url: "https://app.test" + path, method: "GET", mode: "cors", ...extra });

describe("service worker shell", () => {
  it("install precaches the shell AND the theme script", async () => {
    const sw = boot();
    await sw.run("install");
    const cached = [...sw.store.get("openglass-shell-v2").keys()];
    expect(cached.sort()).toEqual(["/", "/theme-init.js"]);
  });

  it("activate drops old caches and stale assets but keeps the shell files", async () => {
    const sw = boot();
    await sw.run("install");
    sw.store.set("openglass-shell-v1", new Map([["/old", {}]]));
    sw.store.get("openglass-shell-v2").set("/assets/old-abc.js", {});
    await sw.run("activate");
    expect([...sw.store.keys()]).toEqual(["openglass-shell-v2"]);
    expect([...sw.store.get("openglass-shell-v2").keys()].sort()).toEqual(["/", "/theme-init.js"]);
  });

  it("theme script: fresh when online, cached copy when offline", async () => {
    const sw = boot();
    await sw.run("install");
    const online = await sw.run("fetch", { request: req("/theme-init.js") });
    expect(online.body).toContain("network:");
    sw.setOnline(false);
    const offline = await sw.run("fetch", { request: req("/theme-init.js") });
    expect(offline).toBeDefined();
    expect(offline.body).toContain("network:"); // the copy refreshed by the online fetch
  });

  it("navigation falls back to the cached shell offline", async () => {
    const sw = boot();
    await sw.run("install");
    sw.setOnline(false);
    const res = await sw.run("fetch", { request: req("/chats", { mode: "navigate" }) });
    expect(res).toBeDefined();
  });

  it("API traffic is never intercepted, so never cached", async () => {
    const sw = boot();
    await sw.run("install");
    for (const path of ["/api/v1/users/me", "/api/v1/ws", "/api/v1/chats"]) {
      const handled = await sw.run("fetch", { request: req(path) });
      expect(handled, path).toBeUndefined();
    }
    const all = [...sw.store.values()].flatMap((c) => [...c.keys()]);
    expect(all.some((k) => k.startsWith("/api/"))).toBe(false);
  });

  it("non-GET and cross-origin requests are left alone", async () => {
    const sw = boot();
    await sw.run("install");
    expect(await sw.run("fetch", { request: req("/theme-init.js", { method: "POST" }) })).toBeUndefined();
    expect(await sw.run("fetch", { request: { url: "https://evil.test/theme-init.js", method: "GET", mode: "cors" } })).toBeUndefined();
  });
});
