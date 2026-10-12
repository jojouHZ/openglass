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
  page.on("console", (msg) => console.log(`[${user.tag}] console:`, msg.text()));
  page.on("pageerror", (err) => console.error(`[${user.tag}] pageerror:`, err.message));
  page.on("requestfailed", (req) =>
    console.error(`[${user.tag}] requestfailed:`, req.url(), req.failure()?.errorText),
  );
  page.on("response", async (resp) => {
    const u = resp.url();
    if (!u.includes("/api/v1/chats")) return;
    try {
      const text = await resp.text();
      console.log(`[${user.tag}] response ${resp.status()} ${u}:`, text.slice(0, 2000));
    } catch (e) {
      console.log(`[${user.tag}] response ${resp.status()} ${u}: <could not read body>`);
    }
  });

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
  // Wait for the private toggle — it only renders once the direct chat
  // peer is loaded, which in turn requires the live REST call to return.
  try {
    await expect(page.getByTestId("private-toggle")).toBeVisible({ timeout: 60000 });
  } catch (e) {
    const url = page.url();
    const body = await page.locator("body").innerText().catch(() => "<no body>");
    console.error(`[${user.tag}] private-toggle not visible. url=${url} body=${body.slice(0, 1000)}`);
    throw e;
  }
}

test("private invite -> SAS verify -> view-once -> burn", async ({ browser }) => {
  const aliceCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();

  await seedSession(alice, seed.users.alice);
  await seedSession(bob, seed.users.bob);

  // Alice starts the private session
  await alice.getByTestId("private-toggle").click();
  await expect(alice).toHaveURL(/\/chats\/[^/]+\/private\/setup$/);
  const startBtn = alice.getByTestId("start-private");
  await expect(startBtn).toBeEnabled({ timeout: 30000 });
  await startBtn.click();
  await expect(alice).toHaveURL(/\/chats\/[^/]+\/private\/invite$/);
  await expect(alice.getByTestId("invite-waiting")).toBeVisible();

  // Bob accepts the incoming invitation
  await bob.getByTestId("private-toggle").click();
  await expect(bob).toHaveURL(/\/chats\/[^/]+\/private\/invite$/);
  await expect(bob.getByTestId("invite-incoming")).toBeVisible();
  await bob.getByTestId("invite-accept").click();

  // Both land on SAS verification
  await expect(alice).toHaveURL(/\/chats\/[^/]+\/private\/verify$/, { timeout: 15000 });
  await expect(bob).toHaveURL(/\/chats\/[^/]+\/private\/verify$/, { timeout: 15000 });

  const aliceSAS = await alice.getByTestId("sas-grid").textContent({ timeout: 15000 });
  const bobSAS = await bob.getByTestId("sas-grid").textContent({ timeout: 15000 });
  expect(aliceSAS.trim()).toBe(bobSAS.trim());

  await alice.getByTestId("sas-confirm").click();
  await bob.getByTestId("sas-confirm").click();

  await expect(alice).toHaveURL(/\/chats\/[^/]+\/private$/);
  await expect(bob).toHaveURL(/\/chats\/[^/]+\/private$/);

  // Alice sends a view-once message
  await alice.getByTestId("view-once-toggle").click({ force: true });
  await alice.getByTestId("priv-input").fill("burn after reading", { force: true });
  await alice.getByTestId("priv-send").click({ force: true });

  // Alice's own copy renders immediately (before Bob's receipt arrives)
  try {
    await expect(alice.locator('[data-testid="priv-scroll"]')).toContainText("burn after reading", { timeout: 10000 });
  } catch (e) {
    const errText = await alice.getByTestId("priv-send-error").textContent().catch(() => "<no send error>");
    console.error(`[alice] send failed: ${errText}`);
    throw e;
  }

  // Bob sees it
  await expect(bob.locator('[data-testid="priv-scroll"]')).toContainText("burn after reading", { timeout: 15000 });

  // Receipt from Bob removes Alice's copy
  await expect(alice.locator('[data-testid="priv-scroll"]')).not.toContainText("burn after reading", { timeout: 15000 });

  // Bob leaving the private screen purges his view-once copy
  await bob.getByLabel("back").click();
  await expect(bob).toHaveURL(/\/chats\/[^/]+$/);
  await bob.goto(`/chats/${seed.chatId}/private`);
  await expect(bob.getByTestId("priv-empty")).toBeVisible({ timeout: 5000 });

  // Alice burns the session from the inside
  await alice.getByTestId("burn-btn").click();
  await alice.getByTestId("confirm-action").click();

  // Both return to the public chat
  await expect(alice).toHaveURL(new RegExp(`/chats/${seed.chatId}$`), { timeout: 10000 });
  await expect(bob).toHaveURL(new RegExp(`/chats/${seed.chatId}$`), { timeout: 10000 });

  await aliceCtx.close();
  await bobCtx.close();
});
