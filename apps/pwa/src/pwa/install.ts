// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// beforeinstallprompt fires early (often before the user reaches S15) —
// a module-level listener captures it once, the view reads the deferred
// event whenever it mounts. iOS Safari never fires it: detect and fall
// back to manual instructions.

import { ref } from "vue";

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null);
const installed = ref(false);
let listening = false;

export function initInstallPrompt() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  installed.value = isStandalone();
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we prompt from S15, not the browser chrome
    deferredPrompt.value = e as BeforeInstallPromptEvent;
  });
  window.addEventListener("appinstalled", () => {
    installed.value = true;
    deferredPrompt.value = null;
  });
  window
    .matchMedia("(display-mode: standalone)")
    .addEventListener("change", (e) => (installed.value = e.matches));
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS reports as Mac with touch
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function useInstallPrompt() {
  const canPrompt = () => !!deferredPrompt.value;
  const needsManual = () => isIos() && !installed.value;

  async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
    const ev = deferredPrompt.value;
    if (!ev) return "unavailable";
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    if (outcome === "accepted") {
      deferredPrompt.value = null;
      installed.value = true;
    }
    return outcome;
  }

  return { deferredPrompt, installed, canPrompt, needsManual, promptInstall };
}
