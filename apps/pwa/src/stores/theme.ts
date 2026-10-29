// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Colour mode: Light / Dark / System. The preference is the only thing
// stored (no secrets); the resolved mode is the `dark` class on <html> plus
// the browser's `theme-color`. public/theme-init.js applies the same state
// before first paint — keep the key and colours in sync.

import { defineStore } from "pinia";

export type ThemePref = "light" | "dark" | "system";

export const THEME_KEY = "og.theme";
export const THEME_COLORS = { light: "#f8fafc", dark: "#0b1220" } as const;

const isPref = (v: unknown): v is ThemePref => v === "light" || v === "dark" || v === "system";

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isPref(v) ? v : "system";
  } catch {
    return "system";
  }
}

const systemDark = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

export const useThemeStore = defineStore("theme", {
  state: () => ({ pref: readPref() as ThemePref, systemIsDark: systemDark() }),
  getters: {
    resolved: (s): "light" | "dark" =>
      s.pref === "system" ? (s.systemIsDark ? "dark" : "light") : s.pref,
  },
  actions: {
    /** Apply the current state to the document (idempotent). */
    apply() {
      const dark = this.resolved === "dark";
      document.documentElement.classList.toggle("dark", dark);
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", THEME_COLORS[this.resolved]);
    },
    set(pref: ThemePref) {
      this.pref = pref;
      try {
        localStorage.setItem(THEME_KEY, pref);
      } catch {
        /* storage blocked — the choice lasts for this session */
      }
      this.apply();
    },
    /** Call once at boot: apply, and follow the OS while on "system". */
    init() {
      this.apply();
      if (typeof matchMedia !== "function") return;
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
        this.systemIsDark = e.matches;
        if (this.pref === "system") this.apply();
      });
    },
  },
});
