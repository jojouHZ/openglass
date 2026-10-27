// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package store

import (
	"strings"
	"unicode/utf8"
)

// MaxReportReason — characters, matching the migration's CHECK.
const MaxReportReason = 1024

// cleanReason trims and validates a report reason (shared by both stores).
func cleanReason(reason string) (string, error) {
	r := strings.TrimSpace(reason)
	if n := utf8.RuneCountInString(r); n < 1 || n > MaxReportReason {
		return "", ErrInvalid
	}
	return r, nil
}

func validReportStatus(s string) bool { return s == "" || s == "open" || s == "resolved" }
