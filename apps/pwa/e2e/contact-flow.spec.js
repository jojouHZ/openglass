// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// F1 consent model in a real browser: request -> accept -> direct chat,
// silent decline, group invitation (not a membership until accepted).

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(path.join(__dirname, ".e2e-state.json"), "utf8"));

test.setTimeout(120000);

async function open(browser, user, route = "/chats") {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.error(`[${user.tag}] pageerror:`, err.message));
  await page.goto("/");
  await page.evaluate((u) => {
    localStorage.setItem(
      "og.session",
      JSON.stringify({
        accessToken: u.accessToken,
        refreshToken: u.refreshToken,
        user: {
          id: u.id,
          displayName: u.displayName,
          tag: u.tag,
          avatarUrl: null,
          createdAt: new Date().toISOString(),
        },
        email: u.email,
      }),
    );
  }, user);
  await page.goto(route);
  return { ctx, page };
}

const auth = (u) => ({ Authorization: `Bearer ${u.accessToken}` });

test("contact request: nothing happens until the target accepts", async ({ browser }) => {
  const { alice, carol } = seed.users;
  const a = await open(browser, alice, "/contacts");
  const c = await open(browser, carol, "/chats");

  // Alice finds Carol by tag and sends a request
  await a.page.getByTestId("contact-search-input").fill("carol");
  await a.page.getByTestId("add-contact").click();
  await expect(a.page.getByTestId("request-sent")).toBeVisible();

  // a request is not a contact — Alice cannot open a chat, Carol is only told in her badge
  await expect(c.page.getByTestId("requests-badge")).toHaveText("1", { timeout: 15000 });
  const blocked = await a.page.request.post("/api/v1/chats", {
    headers: auth(alice),
    data: { userId: carol.id },
  });
  expect(blocked.status()).toBe(403);

  // Carol accepts from her contacts screen -> mutual on both sides
  await c.page.goto("/contacts");
  await expect(c.page.getByTestId("incoming-request")).toContainText("Alice");
  await c.page.getByTestId("req-accept").click();
  await expect(c.page.getByTestId("incoming-request")).toHaveCount(0);

  const opened = await a.page.request.post("/api/v1/chats", {
    headers: auth(alice),
    data: { userId: carol.id },
  });
  expect(opened.ok()).toBe(true);

  // the live accept event reaches Alice: Carol moved from "sent" to contacts
  await a.page.goto("/contacts");
  await expect(a.page.getByTestId("outgoing-request")).toHaveCount(0);

  // ---- ending the contact: the chat stays, as a read-only archive ----
  const chatId = (await opened.json()).chat.id;
  await a.page.request.post(`/api/v1/chats/${chatId}/messages`, {
    headers: auth(alice),
    data: { clientNonce: "e2e-before", text: "before the break" },
  });
  await c.page.goto(`/chats/${chatId}`);
  await expect(c.page.getByText("before the break")).toBeVisible();
  await expect(c.page.getByTestId("composer-input")).toBeEnabled();

  await a.page.goto(`/contacts/${carol.id}`);
  await a.page.getByTestId("action-remove").click();
  await a.page.getByTestId("confirm-action").click();

  // Carol, live, without reloading: a system line naming the actor + a locked composer
  await expect(c.page.getByTestId("system-line")).toContainText("Alice removed you from contacts", {
    timeout: 15000,
  });
  await expect(c.page.getByTestId("not-contacts-banner")).toBeVisible();
  await expect(c.page.getByTestId("composer-input")).toBeDisabled();
  await expect(c.page.getByText("before the break")).toBeVisible(); // history stays

  // Alice sees the same line from her side; the server refuses new messages
  await a.page.goto(`/chats/${chatId}`);
  await expect(a.page.getByTestId("system-line")).toContainText("You removed Carol from contacts");
  await expect(a.page.getByTestId("composer-input")).toBeDisabled();
  const refused = await a.page.request.post(`/api/v1/chats/${chatId}/messages`, {
    headers: auth(alice),
    data: { clientNonce: "e2e-after", text: "still there?" },
  });
  expect(refused.status()).toBe(403);

  await a.ctx.close();
  await c.ctx.close();
});

test("group invitation: invisible until accepted, then a normal chat", async ({ browser }) => {
  const { alice, bob } = seed.users;
  const created = await (
    await browser.newContext()
  ).request.post(new URL("/api/v1/groups", test.info().project.use.baseURL).toString(), {
    headers: auth(alice),
    data: { title: "consent crew", memberIds: [bob.id] },
  });
  expect(created.status()).toBe(201);
  const chatId = (await created.json()).chat.id;

  const b = await open(browser, bob, "/chats");
  // Bob sees an invitation, NOT the group
  await expect(b.page.getByTestId("group-invite")).toContainText("consent crew", { timeout: 15000 });
  const hidden = await b.page.request.get(`/api/v1/chats/${chatId}`, { headers: auth(bob) });
  expect(hidden.status()).toBe(404);

  await b.page.getByTestId("invite-accept").click();
  await expect(b.page.getByTestId("group-invite")).toHaveCount(0);
  await expect(b.page.getByTestId("chat-item").filter({ hasText: "consent crew" })).toBeVisible({
    timeout: 15000,
  });
  const visible = await b.page.request.get(`/api/v1/chats/${chatId}`, { headers: auth(bob) });
  expect(visible.status()).toBe(200);

  await b.ctx.close();
});
