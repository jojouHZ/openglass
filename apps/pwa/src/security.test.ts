// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// XSS guard. User-controlled text (messages, names, report reasons…) must only
// ever reach the DOM through Vue's escaping interpolation. These sinks turn
// strings into markup or code, so they are banned from the shipped sources;
// a legitimate need must be argued in review and the allowlist edited here.

import { describe, expect, it } from "vitest";

// every shipped source file of the PWA and the shared core, as raw text
const sources = import.meta.glob(
  [
    "./**/*.{vue,ts,js}",
    "../../../packages/core/src/**/*.{vue,ts,js}",
    "!./**/*.test.ts",
    "!../../../packages/core/src/**/*.test.ts",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

// built from pieces so this file does not trip its own scan
const SINKS: Array<[string, RegExp]> = [
  ["v-html", new RegExp("v-" + "html")],
  ["innerHTML", new RegExp("inner" + "HTML")],
  ["outerHTML", new RegExp("outer" + "HTML")],
  ["insertAdjacentHTML", new RegExp("insertAdjacent" + "HTML")],
  ["document.write", new RegExp("document\\." + "write")],
  ["eval(", new RegExp("\\be" + "val\\(")],
  ["new Function(", new RegExp("new " + "Function\\(")],
  ["javascript: URL", new RegExp("javascript" + ":", "i")],
];

describe("XSS sinks are banned from shipped sources", () => {
  const all = Object.entries(sources);

  it("scans a meaningful number of files", () => {
    expect(all.length).toBeGreaterThan(40);
  });

  for (const [label, re] of SINKS) {
    it(`no ${label}`, () => {
      const hits = all.filter(([, text]) => re.test(text)).map(([path]) => path);
      expect(hits).toEqual([]);
    });
  }
});
