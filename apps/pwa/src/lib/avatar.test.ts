// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";

import { AVATAR_HUES, AVATAR_LIGHT, AVATAR_SAT, avatarBackground, avatarHue, initials } from "./avatar";

function hslToHex(h: number, s: number, l: number) {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}
const lum = (h: string) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};

describe("avatar colours", () => {
  it("is stable per tag and case-insensitive", () => {
    expect(avatarHue("anna#0001")).toBe(avatarHue("anna#0001"));
    expect(avatarHue("ANNA#0001")).toBe(avatarHue("anna#0001"));
    expect(avatarBackground("anna#0001")).toMatch(/^hsl\(\d+ 55% 32%\)$/);
  });

  it("spreads people over several hues", () => {
    const hues = new Set(Array.from({ length: 200 }, (_, i) => avatarHue(`user${i}#${1000 + i}`)));
    expect(hues.size).toBeGreaterThanOrEqual(8);
  });

  it("never uses the violet band reserved for the private layer", () => {
    for (const h of AVATAR_HUES) expect(h < 250 || h > 300).toBe(true);
  });

  it("white initials are AA on every swatch", () => {
    for (const h of AVATAR_HUES) {
      const bg = hslToHex(h, AVATAR_SAT, AVATAR_LIGHT);
      const ratio = (1 + 0.05) / (lum(bg) + 0.05);
      expect(ratio, `hue ${h}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("initials", () => {
    expect(initials("anna")).toBe("A");
    expect(initials("Anna Lee")).toBe("AL");
    expect(initials("anna#0001")).toBe("A");
    expect(initials("")).toBe("?");
  });
});
