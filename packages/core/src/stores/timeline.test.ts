// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Timeline rules (F1.2): system lines, tombstones, the 15-minute edit window.

import { describe, expect, it } from "vitest";

import type { Message } from "../api/client";
import { EDIT_WINDOW_MS, canEdit, systemText, toSeries } from "./chats";

const ME = "00000000-0000-4000-8000-00000000000a";
const PEER = "00000000-0000-4000-8000-00000000000b";

function msg(over: Partial<Message> & { id: string }): Message {
  return {
    chatId: "c1",
    seq: 1,
    senderId: ME,
    text: "hi",
    clientNonce: over.id,
    sentAt: "2026-10-26T12:00:00.000Z",
    pinned: false,
    kind: "user",
    ...over,
  } as Message;
}

describe("canEdit — 15 minute window", () => {
  const sent = Date.parse("2026-10-26T12:00:00.000Z");
  it("own message inside the window", () => {
    expect(canEdit(msg({ id: "a" }), ME, sent + EDIT_WINDOW_MS - 1)).toBe(true);
  });
  it("closes exactly at the window", () => {
    expect(canEdit(msg({ id: "a" }), ME, sent + EDIT_WINDOW_MS)).toBe(false);
  });
  it("never for someone else's, system, or retracted messages", () => {
    expect(canEdit(msg({ id: "a", senderId: PEER }), ME, sent)).toBe(false);
    expect(canEdit(msg({ id: "b", kind: "system" }), ME, sent)).toBe(false);
    expect(canEdit(msg({ id: "c", deletedAt: "2026-10-26T12:01:00Z" }), ME, sent)).toBe(false);
    expect(canEdit(msg({ id: "d" }), undefined, sent)).toBe(false);
  });
});

describe("toSeries — system lines stand alone", () => {
  it("a system line never joins a sender's series", () => {
    const series = toSeries([
      msg({ id: "1", seq: 1 }),
      msg({ id: "2", seq: 2, kind: "system", text: null, systemEvent: { type: "contact_removed", actorId: ME } }),
      msg({ id: "3", seq: 3 }),
    ]);
    expect(series.map((s) => s.map((m) => m.id))).toEqual([["1"], ["2"], ["3"]]);
  });
});

describe("systemText — rendered per viewer", () => {
  const ev = (actorId: string) =>
    msg({ id: "s", kind: "system", text: null, systemEvent: { type: "contact_removed", actorId } });
  it("the actor reads 'You removed …'", () => {
    expect(systemText(ev(ME), ME, "Anna")).toMatch(/^You removed Anna from contacts/);
  });
  it("the other party reads '<name> removed you …'", () => {
    expect(systemText(ev(PEER), ME, "Anna")).toMatch(/^Anna removed you from contacts/);
  });
  it("both versions say what changed and what stays", () => {
    for (const a of [ME, PEER]) {
      const t = systemText(ev(a), ME, "Anna");
      expect(t).toContain("new messages are turned off");
      expect(t).toContain("archive");
    }
  });
});
