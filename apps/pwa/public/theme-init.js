// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Applies the saved colour mode before first paint (no light→dark flash).
// A separate file, not an inline <script>, so a strict Content-Security-Policy
// stays possible. Keep in sync with src/stores/theme.ts (same key and colours).
(function () {
  var pref = "system";
  try {
    pref = localStorage.getItem("og.theme") || "system";
  } catch (e) {
    /* storage blocked: follow the system */
  }
  var dark =
    pref === "dark" ||
    (pref !== "light" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#0b1220" : "#f8fafc");
})();
