// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(path.join(__dirname, ".e2e-state.json"), "utf8"));

test.setTimeout(120000);

async function seedSession(page, user) {
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
  await page.goto(`/chats/${seed.chatId}`);
}

test("public chat: send text -> live delivery to the peer", async ({ browser }) => {
  const aliceCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();

  await seedSession(alice, seed.users.alice);
  await seedSession(bob, seed.users.bob);

  const composer = alice.getByTestId("composer-input");
  await expect(composer).toBeVisible({ timeout: 60000 });
  const text = `e2e public hello ${Date.now()}`;
  await composer.fill(text);
  await alice.getByTestId("send").click();
  await expect(composer).toHaveValue("");

  // Own copy renders, and Bob's live WS attach delivers the same text
  await expect(alice.getByTestId("msg-scroll")).toContainText(text, { timeout: 15000 });
  await expect(bob.getByTestId("msg-scroll")).toContainText(text, { timeout: 15000 });

  await aliceCtx.close();
  await bobCtx.close();
});
