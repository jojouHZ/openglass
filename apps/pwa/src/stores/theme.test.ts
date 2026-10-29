// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_COLORS, THEME_KEY, useThemeStore } from "./theme";

function mockSystem(dark: boolean) {
  const listeners: Array<(e: { matches: boolean }) => void> = [];
  vi.stubGlobal("matchMedia", () => ({
    matches: dark,
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.push(fn),
  }));
  return (matches: boolean) => listeners.forEach((l) => l({ matches }));
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.head.innerHTML = '<meta name="theme-color" content="#f8fafc">';
  setActivePinia(createPinia());
});

const meta = () => document.querySelector('meta[name="theme-color"]')!.getAttribute("content");

describe("theme store", () => {
  it("defaults to the system mode and follows it", () => {
    mockSystem(true);
    const t = useThemeStore();
    expect(t.pref).toBe("system");
    t.apply();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(meta()).toBe(THEME_COLORS.dark);
  });

  it("an explicit choice beats the system and is persisted", () => {
    mockSystem(true);
    const t = useThemeStore();
    t.set("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(meta()).toBe(THEME_COLORS.light);
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
    t.set("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
  });

  it("restores the saved preference and ignores garbage", () => {
    mockSystem(false);
    localStorage.setItem(THEME_KEY, "dark");
    expect(useThemeStore().pref).toBe("dark");
    setActivePinia(createPinia());
    localStorage.setItem(THEME_KEY, "<script>");
    expect(useThemeStore().pref).toBe("system");
  });

  it("live OS changes re-apply only while on 'system'", () => {
    const flip = mockSystem(false);
    const t = useThemeStore();
    t.init();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    flip(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    t.set("light");
    flip(false);
    flip(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("keeps working when storage is blocked", () => {
    mockSystem(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const t = useThemeStore();
    expect(() => t.set("dark")).not.toThrow();
    expect(t.resolved).toBe("dark");
    vi.restoreAllMocks();
  });
});
