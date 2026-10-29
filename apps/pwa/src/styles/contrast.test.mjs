// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// (plain .mjs on purpose: it reads the CSS from disk with node:fs, which the
// browser-typed src/ tsconfig does not know about)
//
// The four colour modes are read from the SHIPPED css (not a copy) and every
// text/background pair of the concept is checked against WCAG AA; private
// tokens must also stay visibly different from the public ones.

import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
const tokensCss = read("tokens.css");
const privateCss = read("private.css");

function block(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no ${selector} block`);
  const out = {};
  for (const [, k, v] of m[1].matchAll(/--og-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) out[k] = v;
  return out;
}

const modes = {
  light: block(tokensCss, ":root"),
  dark: block(tokensCss, ".dark"),
  privateLight: block(privateCss, ".private-mode"),
  privateDark: block(privateCss, ".dark .private-mode"),
};

const lum = (h) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const blend = (fg, bg, a) =>
  "#" +
  [1, 3, 5]
    .map((i) =>
      Math.round(parseInt(fg.slice(i, i + 2), 16) * a + parseInt(bg.slice(i, i + 2), 16) * (1 - a))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
function hue(h) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const x = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (x * 60 + 360) % 360;
}
const hueGap = (a, b) => {
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d);
};

const pairs = (m) => [
  ["body text", m.fg, m.bg, 4.5],
  ["secondary text", m.mfg, m.bg, 4.5],
  ["secondary text on card", m.mfg, m.card, 4.5],
  ["button label", m.pfg, m.primary, 4.5],
  ["link on bg", m.link, m.bg, 4.5],
  ["incoming bubble", m.infg, m.inb, 4.5],
  ["own bubble", m.ownfg, m.ownb, 4.5],
  ["chip verified", m.okf, m.okb, 4.5],
  ["chip private", m.pvf, m.pvb, 4.5],
  ["chip neutral", m.nf, m.nb, 4.5],
  ["chip warning", m.warnf, m.warnb, 4.5],
  ["danger text", m.danger, m.bg, 4.5],
  ["recessed public bubble (60%)", blend(m.infg, m.inb, 0.6), m.inb, 3],
];

describe("palettes parse completely", () => {
  for (const [name, m] of Object.entries(modes)) {
    it(`${name} defines every token`, () => {
      for (const k of ["bg", "card", "fg", "mfg", "muted", "border", "primary", "pfg", "link", "inb", "infg", "ownb", "ownfg", "okb", "okf", "pvb", "pvf", "nb", "nf", "warnb", "warnf", "danger"])
        expect(m[k], `${name}.${k}`).toMatch(/^#[0-9a-f]{6}$/i);
    });
  }
});

describe("WCAG AA in every mode", () => {
  for (const [name, m] of Object.entries(modes)) {
    for (const [label, fg, bg, min] of pairs(m)) {
      it(`${name} · ${label} ≥ ${min}:1`, () => {
        expect(ratio(fg, bg)).toBeGreaterThanOrEqual(min);
      });
    }
  }
});

describe("private layer is unmistakable", () => {
  const cases = [
    ["on light", modes.light, modes.privateLight],
    ["on dark", modes.dark, modes.privateDark],
  ];
  for (const [label, pub, priv] of cases) {
    for (const k of ["bg", "primary", "ownb"]) {
      it(`${label}: ${k} differs in hue by ≥ 20°`, () => {
        expect(hueGap(pub[k], priv[k])).toBeGreaterThanOrEqual(20);
      });
    }
    it(`${label}: private scope carries the mask pattern tokens`, () => {
      expect(priv.pattern).toMatch(/^#[0-9a-f]{6}$/i);
    });
  }
  it("private tokens never leak into the always-shipped stylesheet", () => {
    expect(tokensCss).not.toMatch(/private-mode|og-pattern/);
  });
});
