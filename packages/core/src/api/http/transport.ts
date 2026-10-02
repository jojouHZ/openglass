// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { ApiRequestError } from "../client";
import type { ApiError } from "../client";

export interface RequestInit {
  method: string;
  path: string;
  /** Root-relative path, skips baseUrl (e.g. /healthz lives outside /api/v1) */
  absolute?: boolean;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  file?: File;
  /** Return the raw body as Blob (attachment downloads). */
  blob?: boolean;
}

/**
 * Minimal fetch transport for the OpenGlass REST contract.
 * - JSON bodies and responses; multipart only for attachments
 * - Error responses carry the `{ error: {code,message,details} }`
 *   envelope from docs/api/errors.md — surfaced as ApiRequestError
 * - Bearer token is injected per request via the provided getter
 */
export class HttpTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly getAccessToken: () => string | null,
  ) {}

  async request<T>(init: RequestInit): Promise<T> {
    const url = new URL(
      init.absolute ? init.path : this.baseUrl + init.path,
      locationOrigin(),
    );
    if (init.query) {
      for (const [k, v] of Object.entries(init.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const headers = new Headers();
    const token = this.getAccessToken();
    if (token) headers.set("authorization", `Bearer ${token}`);

    let body: BodyInit | undefined;
    if (init.file) {
      const fd = new FormData();
      fd.set("file", init.file);
      body = fd; // browser sets the multipart boundary
    } else if (init.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.body);
    }

    const res = await fetch(url, {
      method: init.method,
      headers,
      body,
      credentials: "same-origin",
    });

    if (res.status === 204) return undefined as T;
    if (init.blob && res.ok) return (await res.blob()) as T;

    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    if (!res.ok) {
      const err = (json.error ?? {
        code: "internal",
        message: res.statusText,
      }) as ApiError;
      throw new ApiRequestError(res.status, err);
    }
    return json as T;
  }
}

function locationOrigin(): string {
  // Node (vitest) has no location — the mock server intercepts absolute
  // URLs regardless, so any stable origin works there.
  return typeof location === "undefined" ? "http://localhost" : location.origin;
}
