// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Minimal app service worker — caches the built shell only.
// /api/* and /api/v1/ws are always network: no authenticated or realtime
// payload may ever be served from cache.

const CACHE = "openglass-shell-v2";
// non-hashed shell files that must also work offline (see index.html)
const SHELL_FILES = ["/", "/theme-init.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      // bound cache growth: hashed asset names churn per deploy, so stale
      // entries are dropped on every SW version change — "/" re-caches on
      // next navigation
      .then(() =>
        caches.open(CACHE).then((cache) =>
          cache.keys().then((keys) =>
            Promise.all(
              keys
                .filter((k) => !SHELL_FILES.includes(new URL(k.url).pathname))
                .map((k) => cache.delete(k)),
            ),
          ),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  // the pre-paint theme script: fresh when online, cached when offline
  if (url.pathname === "/theme-init.js") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put("/theme-init.js", copy));
          return res;
        })
        .catch(() => caches.match("/theme-init.js")),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ||
          fetch(event.request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
            return res;
          }),
      ),
    );
  }
});
