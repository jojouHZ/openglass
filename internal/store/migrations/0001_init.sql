-- Copyright (C) 2025 OpenGlass contributors
-- SPDX-License-Identifier: AGPL-3.0-only

-- Auth-layer schema: users / invites / otp / device sessions.
-- Public messaging tables (chats, messages, …) land with their slices.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email        citext UNIQUE NOT NULL,
    display_name text,                     -- NULL until completeProfile
    tag          citext UNIQUE,            -- name#NNNN, immutable once set
    avatar_url   text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invites (
    code       text PRIMARY KEY,
    uses_left  int NOT NULL DEFAULT 1,
    expires_at timestamptz
);

CREATE TABLE IF NOT EXISTS otp_codes (
    email           citext PRIMARY KEY,
    code_hash       text NOT NULL,          -- Argon2id — never store plaintext
    attempts_left   int  NOT NULL,
    expires_at      timestamptz NOT NULL,
    next_resend_at  timestamptz NOT NULL,   -- contract cooldown: now + 60s
    invite_code     text,                   -- pending invite, consumed on verify
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name  text NOT NULL,
    refresh_hash bytea NOT NULL,            -- sha256(refresh token)
    revoked_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version    int PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);
