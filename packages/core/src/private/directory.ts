// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { components, operations } from "../api/schema.gen";
import { HttpTransport } from "../api/http/transport";

export type PublishedIdentityKey = components["schemas"]["IdentityKey"];
export type PublishIdentityKeyBody = operations["putIdentityKey"]["requestBody"]["content"]["application/json"];

export class IdentityDirectory {
  private readonly transport: HttpTransport;

  constructor(baseUrl: string, getAccessToken: () => string | null) {
    this.transport = new HttpTransport(baseUrl, getAccessToken);
  }

  async publish(body: PublishIdentityKeyBody): Promise<PublishedIdentityKey> {
    const { key } = await this.transport.request<{ key: PublishedIdentityKey }>({
      method: "PUT",
      path: "/users/me/identity-keys",
      body: { keyId: body.keyId, publicKey: body.publicKey, label: body.label },
    });
    return key;
  }

  async listMine(): Promise<PublishedIdentityKey[]> {
    const { keys } = await this.transport.request<{ keys: PublishedIdentityKey[] }>({
      method: "GET",
      path: "/users/me/identity-keys",
    });
    return keys;
  }

  async listPeer(peerId: string): Promise<PublishedIdentityKey[]> {
    const { keys } = await this.transport.request<{ keys: PublishedIdentityKey[] }>({
      method: "GET",
      path: `/users/${encodeURIComponent(peerId)}/identity-keys`,
    });
    return keys;
  }

  revoke(keyId: string): Promise<void> {
    return this.transport.request<void>({
      method: "DELETE",
      path: `/users/me/identity-keys/${encodeURIComponent(keyId)}`,
    });
  }
}
