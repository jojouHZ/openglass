// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../api/client";
import { IdentityDirectory } from "./directory";

const key = { keyId: "device-key", publicKey: "public-spki", label: "phone", createdAt: "2026-11-05T00:00:00Z" };

afterEach(() => vi.unstubAllGlobals());

describe("identity directory transport", () => {
  it("publishes only public fields using PUT and the current bearer token", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ key })));
    vi.stubGlobal("fetch", fetcher);
    let token = "first-token";
    const directory = new IdentityDirectory("/api/v1", () => token);
    token = "current-token";
    const body = { ...key, privateKey: "must-not-leave-core", verifiedAt: "local-only" };
    expect(await directory.publish(body)).toEqual(key);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe("/api/v1/users/me/identity-keys");
    expect(init.method).toBe("PUT");
    expect(init.headers.get("authorization")).toBe("Bearer current-token");
    expect(JSON.parse(init.body)).toEqual({ keyId: key.keyId, publicKey: key.publicKey, label: key.label });
  });

  it("lists own and peer keys without interpreting directory data as verified", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ keys: [key] }))));
    vi.stubGlobal("fetch", fetcher);
    const directory = new IdentityDirectory("/api/v1", () => "token");
    expect(await directory.listMine()).toEqual([key]);
    expect(await directory.listPeer("peer/id?#")).toEqual([key]);
    expect(new URL(String(fetcher.mock.calls[0]![0])).pathname).toBe("/api/v1/users/me/identity-keys");
    expect(new URL(String(fetcher.mock.calls[1]![0])).pathname).toBe("/api/v1/users/peer%2Fid%3F%23/identity-keys");
    expect(fetcher.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
  });

  it("revokes an encoded key id and accepts an empty 204 response", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    const directory = new IdentityDirectory("/api/v1", () => "token");
    await expect(directory.revoke("key/id?#")).resolves.toBeUndefined();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe("/api/v1/users/me/identity-keys/key%2Fid%3F%23");
    expect(init.method).toBe("DELETE");
  });

  it.each([401, 404, 409, 500])("propagates HTTP %i rather than converting it to trusted or empty data", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: { code: "directory_error", message: "Rejected" } }), { status }))));
    const directory = new IdentityDirectory("/api/v1", () => null);
    await expect(directory.listPeer("peer")).rejects.toMatchObject({ status, apiError: { code: "directory_error" } });
    await expect(directory.publish(key)).rejects.toBeInstanceOf(ApiRequestError);
    await expect(directory.revoke(key.keyId)).rejects.toBeInstanceOf(ApiRequestError);
  });
});
