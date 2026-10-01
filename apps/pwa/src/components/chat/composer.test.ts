// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import Composer from "./Composer.vue";

describe("Composer keys", () => {
  const mountComposer = () =>
    mount(Composer, {
      props: { offline: false, replyTo: null, editing: null, staged: null },
    });

  it("Enter sends, Shift+Enter inserts a newline", async () => {
    const w = mountComposer();
    const input = w.find('[data-testid="composer-input"]');
    await input.setValue("line one");
    await input.trigger("keydown", { key: "Enter", shiftKey: true });
    expect(w.emitted("send")).toBeUndefined();

    await input.setValue("line one\nline two");
    await input.trigger("keydown", { key: "Enter" });
    expect(w.emitted("send")).toEqual([["line one\nline two"]]);
  });
});
