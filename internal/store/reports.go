// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package store

import (
	"strings"
	"unicode/utf8"
)

// MaxOpenReportsPerReporter bounds how many unresolved reports one user can
// have: the rate limit stops bursts, this stops a slow flood of the
// operator's queue. Resolving a report frees a slot.
const MaxOpenReportsPerReporter = 50

// MaxReportReason — characters, matching the migration's CHECK.
const MaxReportReason = 1024

// cleanReason trims and validates a report reason (shared by both stores).
func cleanReason(reason string) (string, error) {
	r := strings.TrimSpace(reason)
	if n := utf8.RuneCountInString(r); n < 1 || n > MaxReportReason {
		return "", ErrInvalid
	}
	// a NUL byte is not storable in a Postgres text column — refuse it up
	// front (400) instead of failing in the database (500); invalid UTF-8
	// would be rejected for the same reason
	if strings.ContainsRune(r, 0) || !utf8.ValidString(r) {
		return "", ErrInvalid
	}
	return r, nil
}

func validReportStatus(s string) bool { return s == "" || s == "open" || s == "resolved" }
