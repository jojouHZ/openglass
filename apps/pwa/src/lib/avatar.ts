// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Avatar colour from the user's tag: stable per person, no upload needed.
// Hues are a curated list that skips the violet band (≈255°–295°), which
// is reserved for the private layer — a coloured avatar must never look
// like a private-mode cue. White text on every swatch is AA (tested).

export const AVATAR_HUES = [8, 28, 48, 95, 140, 170, 195, 215, 235, 330] as const;
export const AVATAR_SAT = 55;
export const AVATAR_LIGHT = 32;

/** FNV-1a plus a murmur-style finaliser: stable, and every input bit
 *  reaches the low bits we take the modulo of (plain FNV spreads
 *  similar tags like user1#1001 / user2#1002 over too few hues). */
export function hashTag(tag: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < tag.length; i++) {
    h ^= tag.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function avatarHue(tag: string): number {
  return AVATAR_HUES[hashTag(tag.toLowerCase()) % AVATAR_HUES.length]!;
}

export function avatarBackground(tag: string): string {
  return `hsl(${avatarHue(tag)} ${AVATAR_SAT}% ${AVATAR_LIGHT}%)`;
}

/** Up to two initials: "anna#0001" → "A", "Anna Lee" → "AL". */
export function initials(name: string): string {
  const parts = name.replace(/#\d+$/, "").trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : (parts[0]?.[0] ?? "?")).toUpperCase();
}
