-- Copyright (C) 2025 OpenGlass contributors
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- F7 device identity directory: PUBLIC keys only. The server must never
-- learn who verified whom — verification is a local pin on each device,
-- this table is only an untrusted lookup of "which identity key does
-- user X's device publish". revoked_at is soft-delete: key history stays
-- auditable while lookup returns active keys only.
CREATE TABLE device_identity_keys (
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_id      text        NOT NULL,
    public_key  text        NOT NULL,  -- base64 SPKI, written by the device itself
    label       text        NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    revoked_at  timestamptz,
    PRIMARY KEY (user_id, key_id)
);
CREATE INDEX device_identity_keys_active
    ON device_identity_keys (user_id)
    WHERE revoked_at IS NULL;
