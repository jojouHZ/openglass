-- Copyright (C) 2025 OpenGlass contributors
-- SPDX-License-Identifier: AGPL-3.0-only

-- System messages (slice F1.2): structured, viewer-rendered events that live
-- in the timeline — e.g. "X removed you from contacts". sender_id is the
-- actor; text stays NULL; the client builds the sentence per viewer.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'user'
    CHECK (kind IN ('user','system')),
  ADD COLUMN IF NOT EXISTS system_event jsonb;
