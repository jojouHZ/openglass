// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// F7 pins — the local verified-contact graph (pwa-dev only).
//
// A pin records "peer U's device identity key K was verified out-of-band
// at time T". Pins are LOCAL ONLY: the server must never learn who
// verified whom (that's why Contact.verifiedAt left the API contract).
// Pins live in the same IndexedDB as the identity — teardown/logout
// wipes the whole DB, so pins die on sign-out by design until F8.

import { PINS_STORE, idbAll, idbDelete, idbGet, idbPut } from "./keys";

export interface DevicePin {
  /** the peer's USER id (contacts are users; verification is device-pair) */
  peerUserId: string;
  /** the peer's published identity key id we pinned */
  keyId: string;
  /** the peer's identity public key (b64 SPKI) we verified — key changes
   *  must be detected against this value */
  publicKey: string;
  /** ISO timestamp of the ritual confirmation */
  verifiedAt: string;
}

const pinKey = (meUserId: string, peerUserId: string): string =>
  `${meUserId}:${peerUserId}`;

export type VerificationState =
  | "unverified" // no pin for this peer device
  | "verified" // pin exists AND the published key matches
  | "key-changed"; // pin exists but the published key differs

/** All pins of the signed-in user. */
export async function listPins(meUserId: string): Promise<DevicePin[]> {
  const all = await idbAll<DevicePin>(PINS_STORE);
  return all.filter((p) => p.peerUserId !== meUserId);
}

export async function getPin(
  meUserId: string,
  peerUserId: string,
): Promise<DevicePin | undefined> {
  return idbGet<DevicePin>(PINS_STORE, pinKey(meUserId, peerUserId));
}

export async function savePin(meUserId: string, pin: DevicePin): Promise<void> {
  await idbPut(PINS_STORE, pinKey(meUserId, peerId(pin)), pin);
}

export async function deletePin(
  meUserId: string,
  peerUserId: string,
): Promise<void> {
  await idbDelete(PINS_STORE, pinKey(meUserId, peerUserId));
}

const peerId = (p: DevicePin): string => p.peerUserId;

/** Compare the pinned key with the peer's CURRENTLY published key.
 *  peerPubB64 = "" (peer never published) → unverified. */
export async function verificationState(
  meUserId: string,
  peerUserId: string,
  peerPubB64: string,
): Promise<VerificationState> {
  const pin = await getPin(meUserId, peerUserId);
  if (!pin) return "unverified";
  if (!peerPubB64 || pin.publicKey !== peerPubB64) return "key-changed";
  return "verified";
}
