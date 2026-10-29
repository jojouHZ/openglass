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

// Invite → accept → SAS → verify — both pages land on the private chat.
async function establishSession(alice, bob, { strict = false } = {}) {
  // Alice starts the private session
  await alice.getByTestId("private-toggle").click();
  await expect(alice).toHaveURL(/\/chats\/[^/]+\/private\/setup$/);
  if (strict) await alice.getByTestId("opt-strict").click();
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

  // Bob leaving the private screen purges his read view-once copy.
  // In-app navigation only — a page reload would wipe the whole volatile
  // session and priv-empty would prove nothing.
  await bob.getByLabel("back").click();
  await expect(bob).toHaveURL(/\/chats\/[^/]+$/);
  await bob.getByTestId("private-toggle").click();
  await expect(bob).toHaveURL(/\/chats\/[^/]+\/private$/);
  await expect(bob.getByTestId("priv-empty")).toBeVisible({ timeout: 5000 });

  // Alice burns the session from the inside — the relay's closed frame
  // ejects Bob from the private screen he re-entered.
  await alice.getByTestId("burn-btn").click();
  await alice.getByTestId("confirm-action").click();

  // Both return to the public chat
  await expect(alice).toHaveURL(new RegExp(`/chats/${seed.chatId}$`), { timeout: 10000 });
  await expect(bob).toHaveURL(new RegExp(`/chats/${seed.chatId}$`), { timeout: 10000 });

  await aliceCtx.close();
  await bobCtx.close();
});

test("zero-trace teardown: tab close ejects peer and leaves no identity in IndexedDB", async ({ browser }) => {
  const aliceCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();

  await seedSession(alice, seed.users.alice);
  await seedSession(bob, seed.users.bob);
  // strict session: the relay closes it instantly on peer disconnect —
  // no 60 s grace wait in the test
  await establishSession(alice, bob, { strict: true });

  // Give teardown something real to wipe: stand up the private identity
  // DB the dev-tier keystore uses and put a marker record in it. (The
  // runtime store is volatile-only today; this exercises the real wipe
  // path, not a trivial absence.)
  await bob.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("openglass-private", 1);
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

  // Hard close — pagehide → teardown() (or a dirty kill; either way the
  // next boot's prepareIdentityStore sweep must leave nothing behind)
  await bob.close();

  // Strict peer-gone: relay.closed ejects Alice from the private screen
  await expect(alice).toHaveURL(new RegExp(`/chats/${seed.chatId}$`), { timeout: 15000 });

  // A fresh page in Bob's context boots the module — whichever path ran
  // (graceful teardown or the dirty-boot sweep), the marker must be gone.
  // The assertion is about the identity record, not about the DB name: the
  // boot sweep itself may leave an empty DB behind, and polling for the
  // name raced with that boot (flaky on a loaded machine).
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
      { timeout: 15000, message: "identity marker must not survive a dirty close" },
    )
    .toBe(false);

  await probe.close();
  await aliceCtx.close();
  await bobCtx.close();
});
