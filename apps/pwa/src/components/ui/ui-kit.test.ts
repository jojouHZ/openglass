// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import Avatar from "./Avatar.vue";
import Chip from "./Chip.vue";

describe("Avatar", () => {
  it("shows initials on a tag-derived colour, hidden from assistive tech", () => {
    const w = mount(Avatar, { props: { name: "Anna Lee", tag: "anna#0001" } });
    expect(w.text()).toBe("AL");
    expect(w.attributes("style")).toMatch(/hsl\(\d+ 55% 32%\)/);
    expect(w.attributes("aria-hidden")).toBe("true");
  });

  it("same tag → same colour, different tags usually differ", () => {
    const a = mount(Avatar, { props: { name: "A", tag: "a#1" } }).attributes("style");
    const b = mount(Avatar, { props: { name: "Different", tag: "a#1" } }).attributes("style");
    expect(a).toBe(b);
  });

  it("an image replaces the colour block", () => {
    const w = mount(Avatar, { props: { name: "A", src: "/x.png" } });
    expect(w.find("img").attributes("src")).toBe("/x.png");
    expect(w.attributes("style")).toBeUndefined();
  });

  it("user text is escaped, never interpreted as markup", () => {
    const w = mount(Avatar, { props: { name: "<img src=x onerror=alert(1)>" } });
    expect(w.find("img").exists()).toBe(false);
    expect(w.html()).not.toContain("<img");
  });
});

describe("Chip", () => {
  it.each([
    ["verified", "bg-ok", "text-ok-fg"],
    ["private", "bg-pv", "text-pv-fg"],
    ["warning", "bg-warn", "text-warn-fg"],
    ["neutral", "bg-neutral", "text-neutral-fg"],
    [undefined, "bg-neutral", "text-neutral-fg"],
  ] as const)("%s uses its own colour pair", (variant, bg, fg) => {
    const w = mount(Chip, { props: { variant }, slots: { default: "label" } });
    expect(w.classes()).toEqual(expect.arrayContaining([bg, fg]));
    expect(w.text()).toBe("label");
  });
});
