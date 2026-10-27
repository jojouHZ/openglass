-- Copyright (C) 2025 OpenGlass contributors
-- SPDX-License-Identifier: AGPL-3.0-only

-- Abuse reports (slice F4): a user reports another user to the instance
-- operator. A report has no automatic effect; the operator reads it with
-- `ogadmin reports list`. Reports outlive accounts: user references are
-- SET NULL and the tags are snapshotted, so deleting an account never
-- erases the evidence.
CREATE TABLE IF NOT EXISTS reports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reporter_tag   text NOT NULL,
  target_tag     text NOT NULL,
  reason         text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1024),
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz,
  resolved_note  text
);
CREATE INDEX IF NOT EXISTS reports_status_created ON reports (status, created_at);
