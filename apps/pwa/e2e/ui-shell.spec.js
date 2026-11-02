// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// The redesigned shell in a real browser: root navigation, colour modes
// (including no flash on reload), keyboard focus, and 44 px touch targets.

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(path.join(__dirname, ".e2e-state.json"), "utf8"));

test.setTimeout(60000);

async function open(browser, user, route = "/chats", ctxOpts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...ctxOpts });
  const page = await ctx.newPage();
  await page.goto("/");
  await page.evaluate((u) => {
    localStorage.setItem(
      "og.session",
      JSON.stringify({
        accessToken: u.accessToken,
        refreshToken: u.refreshToken,
        user: { id: u.id, displayName: u.displayName, tag: u.tag, avatarUrl: null, createdAt: new Date().toISOString() },
        email: u.email,
      }),
    );
  }, user);
  await page.goto(route);
  return { ctx, page };
}

test("root navigation: bar on Chats/Contacts/Settings, gone inside a chat and sub-screens", async ({ browser }) => {
  const { alice } = seed.users;
  const { ctx, page } = await open(browser, alice);
  const bar = page.getByTestId("tab-bar");

  await expect(bar).toBeVisible();
  await expect(page.getByTestId("tab-chats")).toHaveAttribute("aria-current", "page");

  await page.getByTestId("tab-contacts").click();
  await expect(page).toHaveURL(/\/contacts$/);
  await expect(page.getByTestId("tab-contacts")).toHaveAttribute("aria-current", "page");
  await expect(bar).toBeVisible();

  await page.getByTestId("tab-settings").click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(bar).toBeVisible();

  // sub-screen of Settings: no bar
  await page.getByTestId("security-link").click();
  await expect(page).toHaveURL(/\/settings\/security$/);
  await expect(bar).toHaveCount(0);

  // an open chat: no bar, composer reaches the bottom edge region
  await page.goto(`/chats/${seed.chatId}`);
  await expect(page.getByTestId("composer-input")).toBeVisible();
  await expect(bar).toHaveCount(0);

  await ctx.close();
});

test("dark mode: explicit choice persists, applies before first paint, System follows the OS", async ({ browser }) => {
  const { alice } = seed.users;
  const { ctx, page } = await open(browser, alice, "/settings", { colorScheme: "light" });
  const isDark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));

  await expect.poll(isDark).toBe(false);
  await page.getByTestId("theme-dark").click();
  await expect.poll(isDark).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("og.theme"))).toBe("dark");
  // the browser chrome colour follows too
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0b1220");
  // and the page really is dark (not just a class): the canvas colour is the dark token
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  expect(bg).toBe("rgb(11, 18, 32)");

  // reload: the class must exist when <body> first appears — before any app JS
  await page.addInitScript(() => {
    const mo = new MutationObserver(() => {
      if (document.body && window.__darkAtBody === undefined) {
        window.__darkAtBody = document.documentElement.classList.contains("dark");
        mo.disconnect();
      }
    });
    mo.observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  expect(await page.evaluate(() => window.__darkAtBody)).toBe(true);

  // System follows the OS, live
  await page.getByTestId("theme-system").click();
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(isDark).toBe(false);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(isDark).toBe(true);

  await ctx.close();
});

test("keyboard focus is always visible", async ({ browser }) => {
  const { alice } = seed.users;
  const { ctx, page } = await open(browser, alice);
  await expect(page.getByTestId("tab-bar")).toBeVisible();
  await page.keyboard.press("Tab");
  const ring = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = el && getComputedStyle(el);
    return { tag: el?.tagName, style: cs?.outlineStyle, width: cs?.outlineWidth };
  });
  expect(ring.tag).not.toBe("BODY");
  expect(ring.style).not.toBe("none");
  expect(parseFloat(ring.width)).toBeGreaterThanOrEqual(2);
  await ctx.close();
});

test("touch targets: every button on the root screens and in a chat is at least 44 px", async ({ browser }) => {
  const { alice } = seed.users;
  const { ctx, page } = await open(browser, alice);
  const tooSmall = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("button, a[href], [role=radio]")]
        .filter((e) => e.offsetParent !== null || getComputedStyle(e).position === "fixed")
        .map((e) => {
          const r = e.getBoundingClientRect();
          return { id: e.getAttribute("data-testid") || e.getAttribute("aria-label") || e.textContent.trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) };
        })
        .filter((x) => x.w < 44 || x.h < 44),
    );
  for (const route of ["/chats", "/contacts", "/settings", `/chats/${seed.chatId}`]) {
    await page.goto(route);
    await page.waitForTimeout(800);
    expect(await tooSmall(), `undersized targets on ${route}`).toEqual([]);
  }
  await ctx.close();
});

test("mobile: every text field is >= 16px, so iOS never zooms the page on focus", async ({ browser }) => {
  const { alice } = seed.users;
  // touch emulation => (pointer: coarse), the media query the fix hangs on
  const { ctx, page } = await open(browser, alice, "/chats", { isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const fieldSizes = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("input, textarea, select")]
        .filter((e) => !["checkbox", "radio", "file", "hidden", "range"].includes(e.type))
        .map((e) => ({ id: e.getAttribute("data-testid") || e.placeholder || e.tagName, px: parseFloat(getComputedStyle(e).fontSize) })),
    );

  for (const route of ["/chats", "/contacts", `/chats/${seed.chatId}`]) {
    await page.goto(route);
    await page.waitForTimeout(600);
    const sizes = await fieldSizes();
    expect(sizes.length, `no text field found on ${route}`).toBeGreaterThan(0);
    expect(sizes.filter((s) => s.px < 16), `small fields on ${route}`).toEqual([]);
  }
  await page.goto("/settings");
  await page.getByTestId("edit-profile").click();
  expect((await fieldSizes()).filter((s) => s.px < 16)).toEqual([]);
  await ctx.close();

  // signed out: the e-mail and code fields of the login flow
  const anon = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await anon.newPage();
  await p.goto("/invite");
  await p.waitForTimeout(600);
  const loginSizes = await p.evaluate(() =>
    [...document.querySelectorAll("input")].map((e) => parseFloat(getComputedStyle(e).fontSize)),
  );
  expect(loginSizes.length).toBeGreaterThan(0);
  expect(loginSizes.filter((px) => px < 16)).toEqual([]);
  await anon.close();
});

test("people lists: tap = the chat, right-click = Message · Profile · Report · Remove", async ({ browser }) => {
  const { alice, bob } = seed.users;
  const { ctx, page } = await open(browser, alice, "/contacts");
  const row = page.getByTestId("user-row").filter({ hasText: bob.displayName });
  await expect(row).toBeVisible();

  // right-click: the menu, with every action a contact offers
  await row.click({ button: "right" });
  const menu = page.getByTestId("user-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText(["Message", "Profile", "Report", "Remove contact"]);

  // Report -> the dialog for that person
  await page.getByTestId("um-report").click();
  await expect(page.getByTestId("report-dialog")).toContainText(bob.displayName);
  await page.getByTestId("report-cancel").click();

  // Profile
  await row.click({ button: "right" });
  await page.getByTestId("um-profile").click();
  await expect(page).toHaveURL(new RegExp(`/contacts/${bob.id}$`));

  // a plain tap goes straight to the conversation
  await page.goto("/contacts");
  await page.getByTestId("user-row").filter({ hasText: bob.displayName }).click();
  await expect(page).toHaveURL(new RegExp(`/chats/${seed.chatId}$`));
  await expect(page.getByTestId("composer-input")).toBeVisible();

  // Escape closes the menu without acting
  await page.goto("/contacts");
  await page.getByTestId("user-row").filter({ hasText: bob.displayName }).click({ button: "right" });
  await expect(page.getByTestId("user-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("user-menu")).toHaveCount(0);
  await expect(page).toHaveURL(/\/contacts$/);
  await ctx.close();
});
