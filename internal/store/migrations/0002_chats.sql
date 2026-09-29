-- Copyright (C) 2025 OpenGlass contributors
-- SPDX-License-Identifier: AGPL-3.0-only

-- Messaging schema: contacts / chats / members / messages / attachments.
-- Public layer only — private-layer envelopes live elsewhere.

CREATE TABLE IF NOT EXISTS contacts (
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, contact_id)
);

CREATE TABLE IF NOT EXISTS chats (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type       text NOT NULL CHECK (type IN ('direct','group')),
  title      text,                          -- group only; null for direct
  avatar_url text,
  -- direct chats: sorted "lo:hi" pair ("u:u" for self-chat / saved messages)
  direct_key text UNIQUE,
  -- per-chat monotonic message sequence; incremented inside send tx
  last_seq   bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id       uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  rights        jsonb NOT NULL DEFAULT '{}',   -- MemberRights for groups
  last_read_seq bigint NOT NULL DEFAULT 0,
  pinned        boolean NOT NULL DEFAULT false, -- user-side chat pin (S4)
  joined_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id      uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  uploader_id  uuid NOT NULL REFERENCES users(id),
  kind         text NOT NULL CHECK (kind IN ('photo','file')),
  mime_type    text NOT NULL,
  file_name    text,
  size_bytes   bigint NOT NULL,
  storage_path text,                          -- set by #16 upload pipeline
  message_id   uuid,                          -- bound on send; NULL = staged
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id       uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id     uuid NOT NULL REFERENCES users(id),
  seq           bigint NOT NULL,
  text          text,
  reply_to      uuid REFERENCES messages(id),
  client_nonce  text NOT NULL,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  edited_at     timestamptz,
  deleted_at    timestamptz,
  pinned        boolean NOT NULL DEFAULT false,
  UNIQUE (chat_id, seq),
  -- contract idempotency: retry with same nonce returns existing message
  UNIQUE (chat_id, sender_id, client_nonce)
);

CREATE INDEX IF NOT EXISTS messages_chat_seq ON messages (chat_id, seq);
CREATE INDEX IF NOT EXISTS messages_chat_text ON messages (chat_id, seq DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS contacts_owner ON contacts (owner_id);
CREATE INDEX IF NOT EXISTS chat_members_user ON chat_members (user_id);
