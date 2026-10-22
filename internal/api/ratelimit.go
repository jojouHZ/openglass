// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package api

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Auth-endpoint rate limiting — docs/architecture/05-threat-model.md
// ("API / auth endpoint flooding"). Token buckets keyed by client IP,
// plus a per-email bucket on OTP request so a victim's inbox can't be
// spammed through spoofed forwards.
//
// In-memory is deliberate — same stance as the WS replay ring: the
// managed deployment is one instance, so a process-local limiter is
// honest and adds zero infrastructure. Buckets idle >10 min are swept.

type bucket struct {
	tokens float64
	last   time.Time
}

type rateLimiter struct {
	mu      sync.Mutex
	rate    float64 // tokens per second
	burst   float64
	buckets map[string]*bucket
	sweptAt time.Time
}

func newRateLimiter(perMinute, burst int) *rateLimiter {
	return &rateLimiter{
		rate:    float64(perMinute) / 60,
		burst:   float64(burst),
		buckets: map[string]*bucket{},
		sweptAt: time.Now(),
	}
}

// allow consumes one token; on denial it returns how long until a token
// refills (for Retry-After).
func (l *rateLimiter) allow(key string) (retryAfter time.Duration, ok bool) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	l.sweep(now)

	b := l.buckets[key]
	if b == nil {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	b.tokens += now.Sub(b.last).Seconds() * l.rate
	if b.tokens > l.burst {
		b.tokens = l.burst
	}
	b.last = now

	if b.tokens < 1 {
		return time.Duration((1 - b.tokens) / l.rate * float64(time.Second)), false
	}
	b.tokens--
	return 0, true
}

// sweep drops buckets idle >10 min so the map can't grow unbounded.
func (l *rateLimiter) sweep(now time.Time) {
	if now.Sub(l.sweptAt) < 5*time.Minute {
		return
	}
	l.sweptAt = now
	for k, b := range l.buckets {
		if now.Sub(b.last) > 10*time.Minute {
			delete(l.buckets, k)
		}
	}
}

// RateLimitSpec — per-endpoint limits, overridable via WithAuthRateLimits.
type RateLimitSpec struct {
	PerMinute int
	Burst     int
}

// AuthRateLimits — the four auth buckets. Conservative defaults: tight
// enough to block floods, loose enough for shared-NAT offices.
type AuthRateLimits struct {
	OtpRequestIP    RateLimitSpec // flood many emails from one IP
	OtpRequestEmail RateLimitSpec // spam one victim from many IPs
	OtpVerifyIP     RateLimitSpec // brute-force beyond per-account caps
	RefreshIP       RateLimitSpec // token-refresh hammering
	// ContactRequest — per-USER bucket on POST /contacts (request spam).
	// Zero value falls back to the default.
	ContactRequest RateLimitSpec
}

func DefaultAuthRateLimits() AuthRateLimits {
	return AuthRateLimits{
		OtpRequestIP:    RateLimitSpec{PerMinute: 20, Burst: 5},
		OtpRequestEmail: RateLimitSpec{PerMinute: 10, Burst: 3},
		OtpVerifyIP:     RateLimitSpec{PerMinute: 30, Burst: 5},
		RefreshIP:       RateLimitSpec{PerMinute: 60, Burst: 10},
		ContactRequest:  RateLimitSpec{PerMinute: 6, Burst: 20},
	}
}

// WithAuthRateLimits — test/diagnostic override of the auth buckets.
func WithAuthRateLimits(l AuthRateLimits) Option {
	return func(s *Server) {
		s.otpRequestIP = newRateLimiter(l.OtpRequestIP.PerMinute, l.OtpRequestIP.Burst)
		s.otpRequestMail = newRateLimiter(l.OtpRequestEmail.PerMinute, l.OtpRequestEmail.Burst)
		s.otpVerifyIP = newRateLimiter(l.OtpVerifyIP.PerMinute, l.OtpVerifyIP.Burst)
		s.refreshIP = newRateLimiter(l.RefreshIP.PerMinute, l.RefreshIP.Burst)
		cr := l.ContactRequest
		if cr.PerMinute == 0 && cr.Burst == 0 {
			cr = DefaultAuthRateLimits().ContactRequest
		}
		s.contactReq = newRateLimiter(cr.PerMinute, cr.Burst)
	}
}

// clientIP — first X-Forwarded-For hop when present (operators terminate
// TLS at their own reverse proxy, which sets it), else RemoteAddr.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i > 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// rateLimited — contract `rate_limited` (docs/api/errors.md) + Retry-After.
func rateLimited(w http.ResponseWriter, retryAfter time.Duration) {
	secs := int(retryAfter.Seconds()) + 1
	w.Header().Set("Retry-After", itoa(secs))
	writeErr(w, http.StatusTooManyRequests, "rate_limited",
		"Too many requests — retry later",
		map[string]any{"retryAfterS": secs})
}

// limitIP wraps a handler with an IP-bucket check.
func (s *Server) limitIP(l *rateLimiter, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if wait, ok := l.allow("ip|" + clientIP(r)); !ok {
			rateLimited(w, wait)
			return
		}
		h(w, r)
	}
}
