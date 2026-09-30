// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

export interface StagedAttachment {
  fileName: string;
  sizeBytes: number;
  /** set once uploadAttachment resolves */
  attachmentId?: string;
  /** user-facing reason — size rejection or upload failure */
  error?: string;
}

/** Contract limit: 25 MiB (docs/api/errors.md → upload_attachment). */
export const MAX_ATTACHMENT = 25 * 1024 * 1024;
