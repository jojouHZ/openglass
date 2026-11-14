// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(path.join(__dirname, ".e2e-state.json"), "utf8"));

test.setTimeout(120000);
const deviceKeys = new WeakMap();

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
  const publishing = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith("/users/me/identity-keys") && response.request().headers().authorization === `Bearer ${user.accessToken}`).then(async (response) => (await response.json()).key.keyId);
  await page.goto(`/chats/${seed.chatId}`);
  deviceKeys.set(page, await publishing);
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

// Device comparison → pin → invite → accept, all inside the existing chat.
async function establishSession(alice, bob, { strict = false } = {}) {
  // Both users explicitly compare the current published device keys.
  for (const [page, other] of [[alice, bob], [bob, alice]]) {
    await page.getByTestId("private-toggle").click();
    await expect(page.getByTestId("device-verification")).toBeVisible();
    await page.getByTestId("verification-device").selectOption(deviceKeys.get(other));
    await expect(page.getByTestId("verification-fingerprint")).toBeVisible();
  }
  const aliceSAS = await alice.getByTestId("verification-fingerprint").textContent();
  const bobSAS = await bob.getByTestId("verification-fingerprint").textContent();
  expect(aliceSAS.trim()).toBe(bobSAS.trim());
  await alice.getByTestId("verification-confirm").click();
  await bob.getByTestId("verification-confirm").click();
  await expect(alice.getByTestId("device-verification")).not.toBeVisible();
  await expect(bob.getByTestId("device-verification")).not.toBeVisible();

  // Alice starts the private session after the device-pair ritual.
  await alice.getByTestId("private-toggle").click();
  await bob.getByTestId("private-toggle").click();
  await expect(alice.getByTestId("start-private")).toBeEnabled({ timeout: 30000 });
  await alice.getByTestId("start-private").click();
  await expect(alice.getByTestId("private-sheet")).toBeVisible();
  if (strict) await alice.getByTestId("opt-strict").click();
  await alice.getByTestId("sheet-start").click();
  await expect(alice.getByTestId("invite-waiting")).toBeVisible();

  // Bob accepts; signed session keys must pass the stored pin check.
  await expect(bob.getByTestId("invite-incoming")).toBeVisible();
  await bob.getByTestId("invite-accept").click();
  await expect(alice.getByTestId("priv-input")).toBeEnabled({ timeout: 15000 });
  await expect(bob.getByTestId("priv-input")).toBeEnabled({ timeout: 15000 });
  await expect(alice).toHaveURL(new RegExp(`/chats/${seed.chatId}$`));
  await expect(bob).toHaveURL(new RegExp(`/chats/${seed.chatId}$`));
}

test("private invite -> SAS verify -> view-once -> burn", async ({ browser }) => {
  const aliceCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();

  await seedSession(alice, seed.users.alice);
  await seedSession(bob, seed.users.bob);
  await establishSession(alice, bob);

  // Alice sends a view-once message
  await alice.getByTestId("view-once-toggle").click();
  await alice.getByTestId("priv-input").fill("burn after reading");
  await alice.getByTestId("priv-send").click();

  // Send resolved — the composer clears only after remote.send() resolves.
  // NOTE: Alice's own bubble is NOT asserted. By design the sender's
  // view-once copy burns the moment the peer's client receipts the
  // display (store.ts: "peer read our view-once messages — burn our
  // copies now"). Bob's S12 marks displayed on arrival, so the copy
  // dies in ~ms — asserting it would test a race, not a guarantee.
  await expect(alice.getByTestId("priv-input")).toHaveValue("");

  // Bob sees it
  await expect(bob.locator('[data-testid="priv-scroll"]')).toContainText("burn after reading", { timeout: 15000 });

  // Receipt from Bob removes Alice's copy
  await expect(alice.locator('[data-testid="priv-scroll"]')).not.toContainText("burn after reading", { timeout: 15000 });

  // Bob turning the layer OFF ends the session for BOTH sides (rule 3):
  // his read view-once copy dies with it, and each side sees the
  // "session ended · N messages erased" note in the public timeline.
  await bob.getByTestId("private-toggle").click();
  await expect(bob).toHaveURL(/\/chats\/[^/]+$/);
  await expect(bob.getByTestId("private-ended")).toBeVisible({ timeout: 10000 });
  await expect(alice.getByTestId("private-ended")).toBeVisible({ timeout: 10000 });

  // Both return to the public chat
  await expect(alice).toHaveURL(new RegExp(`/chats/${seed.chatId}$`), { timeout: 10000 });
  await expect(bob).toHaveURL(new RegExp(`/chats/${seed.chatId}$`), { timeout: 10000 });

  await aliceCtx.close();
  await bobCtx.close();
});

test("tab close stops the session but preserves trust; explicit teardown wipes IndexedDB", async ({ browser }) => {
  const aliceCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();

  await seedSession(alice, seed.users.alice);
  await seedSession(bob, seed.users.bob);
  // strict session: the relay closes it instantly on peer disconnect —
  // no 60 s grace wait in the test
  await establishSession(alice, bob, { strict: true });

  // Put a marker in the existing dev-tier identity store to distinguish
  // preserving close/reopen from a destructive logout. This is synthetic
  // test data, not a private message or persisted session key; the real
  // device-pair persistence path is covered by device-verification.spec.
  await bob.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("openglass-private", 2);
        req.onupgradeneeded = () => req.result.createObjectStore("identity");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("identity", "readwrite");
          tx.objectStore("identity").put("secret", "marker");
          tx.oncomplete = () => {
            db.close();
            resolve(undefined);
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );

  // Ordinary close — pagehide stops volatile state without deleting
  // identity and pins; explicit teardown below is the deletion boundary.
  await bob.close();

  // Strict peer-gone: relay.closed ejects Alice from the private screen
  await expect(alice).toHaveURL(new RegExp(`/chats/${seed.chatId}$`), { timeout: 15000 });

  // A fresh page in Bob's context boots the module and reuses device
  // trust. The marker must remain until the explicit teardown below.
  // The assertion distinguishes preserved records from an empty database;
  // the separate F7 contract test checks persisted pins and device keys.
  // Polling waits for authenticated bootstrap rather than an arbitrary delay.
  const probe = await bobCtx.newPage();
  await probe.goto("/");
  await expect
    .poll(
      () =>
        probe.evaluate(async () => {
          const names = (await indexedDB.databases()).map((d) => d.name);
          if (!names.includes("openglass-private")) return false;
          return new Promise((resolve) => {
            const req = indexedDB.open("openglass-private");
            req.onerror = () => resolve(false);
            req.onsuccess = () => {
              const db = req.result;
              if (!db.objectStoreNames.contains("identity")) {
                db.close();
                return resolve(false);
              }
              const get = db.transaction("identity").objectStore("identity").get("marker");
              get.onsuccess = () => {
                db.close();
                resolve(get.result === "secret");
              };
              get.onerror = () => {
                db.close();
                resolve(false);
              };
            };
          });
        }),
      { timeout: 15000, message: "identity marker survives ordinary close" },
    )
    .toBe(true);

  await probe.evaluate(async () => {
    const provides = document.querySelector("#app").__vue_app__._context.provides;
    const remote = Reflect.ownKeys(provides).map((key) => provides[key])
      .find((value) => typeof value?.teardown === "function");
    await remote.teardown();
  });
  expect(await probe.evaluate(async () => (await indexedDB.databases()).map((db) => db.name))).not.toContain("openglass-private");
  await probe.close();
  await aliceCtx.close();
  await bobCtx.close();
});
