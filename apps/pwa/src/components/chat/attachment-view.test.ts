// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Attachment } from "@openglass/core";
import { bindApiClient } from "@openglass/core";
import { createMockNodeApiClient } from "@openglass/core/api/mock/node";

import AttachmentView from "./AttachmentView.vue";

const DIRECT = "c0000000-0000-4000-8000-000000000001";
const ctx = createMockNodeApiClient({ mode: "mock", baseUrl: "/api/v1", wsUrl: "/api/v1/ws" });
bindApiClient(ctx.api);

const flush = async (ms = 200) => new Promise((r) => setTimeout(r, ms));

function seed(att: Partial<Attachment> & { id: string }, bytes: Uint8Array) {
  ctx.state.attachments.set(att.id, {
    meta: {
      kind: "file",
      mimeType: "application/octet-stream",
      sizeBytes: bytes.length,
      url: `/api/v1/attachments/${att.id}`,
      ...att,
    } as Attachment,
    bytes,
    chatId: DIRECT,
    messageId: null,
  });
}

beforeAll(() => {
  ctx.api.setAccessToken("mock-access-token"); // mock guard expects this bearer
  // happy-dom lacks createObjectURL — stub it for blob plumbing
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:mock-url"),
    revokeObjectURL: vi.fn(),
  }));
});
afterAll(() => ctx.server.close());

describe("AttachmentView", () => {
  it("renders a photo attachment as an img once the blob loads", async () => {
    seed({ id: "a1000000-0000-4000-8000-000000000001", kind: "photo", mimeType: "image/png", fileName: "p.png" },
      new Uint8Array([1, 2, 3]));
    const w = mount(AttachmentView, {
      props: { att: { id: "a1000000-0000-4000-8000-000000000001", kind: "photo", mimeType: "image/png", fileName: "p.png", sizeBytes: 3, url: "" } },
    });
    await flush();
    const img = w.find('[data-testid="att-photo"]');
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toBe("blob:mock-url");
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("renders a file chip with name and size; click triggers download", async () => {
    seed({ id: "a2000000-0000-4000-8000-000000000001", kind: "file", mimeType: "text/plain", fileName: "notes.txt" },
      new Uint8Array(2048));
    const w = mount(AttachmentView, {
      props: { att: { id: "a2000000-0000-4000-8000-000000000001", kind: "file", mimeType: "text/plain", fileName: "notes.txt", sizeBytes: 2048, url: "" } },
    });
    await flush();
    const chip = w.find('[data-testid="att-file"]');
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain("notes.txt");
    expect(chip.text()).toContain("2 kb");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await chip.trigger("click");
    expect(click).toHaveBeenCalled();
  });

  it("shows the failed state when the download errors", async () => {
    const w = mount(AttachmentView, {
      props: { att: { id: "a3000000-0000-4000-8000-000000000009", kind: "file", mimeType: "text/plain", fileName: "gone.bin", sizeBytes: 1, url: "" } },
    });
    await flush();
    expect(w.find('[data-testid="att-file"]').text()).toContain("download failed");
  });
});
