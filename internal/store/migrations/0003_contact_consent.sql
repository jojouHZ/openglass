-- Copyright (C) 2025 OpenGlass contributors
-- SPDX-License-Identifier: AGPL-3.0-only

-- Contact consent model (slice F1): contacts become mutual pairs only;
-- one-way adds are requests the target must accept. Group membership is
-- gated the same way through a separate invites table (not a column on
-- chat_members, so no existing membership query can ever see an invitee).

CREATE TABLE IF NOT EXISTS contact_requests (
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'declined' is SILENT: hidden from the target, still shown to the
  -- requester as pending (no rejection signal, no re-spam loop)
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','declined')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, target_id),
  CHECK (requester_id <> target_id)
);
CREATE INDEX IF NOT EXISTS contact_requests_target
  ON contact_requests (target_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS group_invites (
  chat_id     uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  invitee_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inviter_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','declined')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, invitee_id)
);
CREATE INDEX IF NOT EXISTS group_invites_invitee
  ON group_invites (invitee_id) WHERE status = 'pending';

-- Existing one-way edges must not silently become consent: they turn
-- into pending requests; only mutual pairs stay in contacts.
INSERT INTO contact_requests (requester_id, target_id, created_at, updated_at)
SELECT c.owner_id, c.contact_id, c.created_at, c.created_at
FROM contacts c
WHERE c.owner_id <> c.contact_id
  AND NOT EXISTS (SELECT 1 FROM contacts r
                  WHERE r.owner_id = c.contact_id AND r.contact_id = c.owner_id)
ON CONFLICT DO NOTHING;

DELETE FROM contacts c
WHERE c.owner_id = c.contact_id
   OR NOT EXISTS (SELECT 1 FROM contacts r
                  WHERE r.owner_id = c.contact_id AND r.contact_id = c.owner_id);
