-- Copyright (C) 2025 OpenGlass contributors
-- SPDX-License-Identifier: AGPL-3.0-only

-- An invite code is the only way to register, so it must not live forever:
-- the operator tool now issues codes that expire in at most 30 days. Bring
-- existing codes under the same rule (no expiry, or more than 30 days left,
-- becomes 30 days from this migration).
UPDATE invites
   SET expires_at = now() + interval '30 days'
 WHERE expires_at IS NULL OR expires_at > now() + interval '30 days';
