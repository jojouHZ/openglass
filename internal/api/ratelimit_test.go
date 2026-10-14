// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package api

import (
	"testing"
	"time"
)

func TestRateLimiterBurstThenDeny(t *testing.T) {
	l := newRateLimiter(60, 2)

	if _, ok := l.allow("k"); !ok {
		t.Fatal("first token should be allowed")
	}
	if _, ok := l.allow("k"); !ok {
		t.Fatal("second token should be allowed (burst)")
	}
	wait, ok := l.allow("k")
	if ok {
		t.Fatal("third request beyond burst must be denied")
	}
	if wait <= 0 || wait > 2*time.Second {
		t.Fatalf("retryAfter out of range: %v", wait)
	}
	// independent keys get their own bucket
	if _, ok := l.allow("other"); !ok {
		t.Fatal("different key must not share the drained bucket")
	}
}

func TestRateLimiterRefill(t *testing.T) {
	l := newRateLimiter(600, 1) // 10 tokens/s
	if _, ok := l.allow("k"); !ok {
		t.Fatal("first should pass")
	}
	time.Sleep(120 * time.Millisecond) // ≈1.2 tokens refilled
	if _, ok := l.allow("k"); !ok {
		t.Fatal("bucket should have refilled one token")
	}
}

func TestRateLimiterSweep(t *testing.T) {
	l := newRateLimiter(60, 1)
	l.sweptAt = time.Now().Add(-6 * time.Minute) // force sweep next allow
	l.buckets["stale"] = &bucket{tokens: 0, last: time.Now().Add(-11 * time.Minute)}
	l.buckets["fresh"] = &bucket{tokens: 0, last: time.Now()}

	l.allow("trigger")
	if _, exists := l.buckets["stale"]; exists {
		t.Fatal("idle bucket should have been swept")
	}
	if _, exists := l.buckets["fresh"]; !exists {
		t.Fatal("recent bucket must survive the sweep")
	}
}
