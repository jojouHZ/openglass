// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const seed = JSON.parse(readFileSync(new URL(".e2e-state.json", import.meta.url), "utf8"));

async function command(page, method, ...args) {
  return page.evaluate(async ({ method, args }) => {
    const provides = document.querySelector("#app").__vue_app__._context.provides;
    const remote = Reflect.ownKeys(provides).map((key) => provides[key])
      .find((value) => typeof value?.watchVerification === "function");
    if (!remote) throw new Error("private remote unavailable");
    if (method.startsWith("watch")) {
      let view;
      const off = remote[method](...args, (snapshot) => { view = snapshot; });
      off();
      return view;
    }
    return remote[method](...args);
  }, { method, args });
}

async function signIn(page, user) {
  await page.goto("/");
  await page.evaluate((user) => {
    localStorage.setItem("og.session", JSON.stringify({
      accessToken: user.accessToken,
      refreshToken: user.refreshToken,
      user: { id: user.id, displayName: user.displayName, tag: user.tag, avatarUrl: null },
      email: user.email,
    }));
  }, user);
  const publishing = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith("/users/me/identity-keys") && response.request().headers().authorization === `Bearer ${user.accessToken}`).then(async (response) => {
    expect(response.ok()).toBe(true);
    return (await response.json()).key.keyId;
  });
  await page.goto(`/chats/${seed.chatId}`);
  await expect(page.getByTestId("private-toggle")).toBeVisible();
  return publishing;
}

test("device-pair ritual survives reload and authenticates a new volatile session", async ({ browser }) => {
  test.setTimeout(90000);
  const aContext = await browser.newContext();
  const bContext = await browser.newContext();
  try {
    const a = await aContext.newPage();
    const b = await bContext.newPage();
    const aKeyId = await signIn(a, seed.users.alice);
    const bKeyId = await signIn(b, seed.users.bob);
    for (const [page, peer, keyId] of [[a, seed.users.bob, bKeyId], [b, seed.users.alice, aKeyId]]) {
      await page.getByTestId("private-toggle").click();
      await expect(page.getByTestId("device-verification")).toBeVisible();
      await page.getByTestId("verification-device").selectOption(keyId);
      await expect(page.getByTestId("verification-fingerprint")).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/chats/${seed.chatId}$`));
      expect((await command(page, "watchVerification", peer.id)).state).toBe("pending");
    }
    const av = await command(a, "watchVerification", seed.users.bob.id);
    const bv = await command(b, "watchVerification", seed.users.alice.id);
    expect(av.fingerprint).toEqual(bv.fingerprint);
    await a.getByTestId("verification-confirm").click();
    await b.getByTestId("verification-confirm").click();
    await expect(a.getByTestId("device-verification")).not.toBeVisible();
    await expect(b.getByTestId("device-verification")).not.toBeVisible();
    await a.reload();
    await b.reload();
    await expect(a.getByTestId("private-toggle")).toBeVisible();
    await expect(b.getByTestId("private-toggle")).toBeVisible();
    for (const [page, peer] of [[a, seed.users.bob], [b, seed.users.alice]]) {
      await expect.poll(async () => (await command(page, "watchVerification", peer.id)).state).toBe("verified");
      expect(await command(page, "watchActiveSessions")).toEqual([]);
    }
    await command(a, "startInvite", { id: seed.users.bob.id, displayName: seed.users.bob.displayName });
    await expect.poll(async () => (await command(b, "watchInvites")).incoming.length).toBe(1);
    const invite = (await command(b, "watchInvites")).incoming[0];
    await command(b, "accept", invite.sessionId);
    for (const page of [a, b]) {
      await expect.poll(async () => (await command(page, "watchActiveSessions"))[0]?.status).toBe("verified");
    }
    await command(a, "send", invite.sessionId, "volatile browser test");
    await expect.poll(async () => (await command(b, "watchActiveSessions"))[0]?.messages[0]?.text).toBe("volatile browser test");
    await a.reload();
    await expect(a.getByTestId("private-toggle")).toBeVisible();
    expect(await command(a, "watchActiveSessions")).toEqual([]);
    await expect.poll(async () => (await command(a, "watchVerification", seed.users.bob.id)).state).toBe("verified");
    const stores = await a.evaluate(async () => new Promise((resolve, reject) => {
      const request = indexedDB.open("openglass-private");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const names = Array.from(db.objectStoreNames);
        db.close();
        resolve(names);
      };
    }));
    expect(stores.sort()).toEqual(["identity", "pins"]);
    await command(a, "teardown");
    expect(await a.evaluate(async () => (await indexedDB.databases()).map((db) => db.name))).not.toContain("openglass-private");
    expect(await command(a, "watchActiveSessions")).toEqual([]);
    expect((await command(a, "watchVerification", seed.users.bob.id)).state).toBe("unverified");
    await command(b, "teardown");
    await signIn(a, seed.users.bob);
    await expect.poll(async () => (await command(a, "watchVerification", seed.users.alice.id)).state).toBe("unverified");
    expect(await command(a, "watchActiveSessions")).toEqual([]);
    await command(a, "teardown");
  } finally {
    await aContext.close();
    await bContext.close();
  }
});
