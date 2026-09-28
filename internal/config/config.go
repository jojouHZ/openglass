// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Package config — env-based server configuration (compose-ready).
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	ListenAddr string // ":8080"
	PgDSN      string // postgres://…
	RedisAddr  string // "localhost:6379"

	JWTSecret         []byte
	AccessTokenTTL    time.Duration // 15m per contract (accessTokenExpiresInS 900)
	RefreshTokenTTL   time.Duration // 30d
	OtpTTL            time.Duration // 600s per contract
	OtpResendCooldown time.Duration // 60s — contract constant OTP_RESEND_COOLDOWN_S
	OtpMaxAttempts    int

	// DevMode enables the log-only OTP sender and verbose errors.
	// MUST be false in production.
	DevMode bool
}

func FromEnv() (*Config, error) {
	secret := os.Getenv("OPENGLASS_JWT_SECRET")
	dev := os.Getenv("OPENGLASS_DEV_MODE") == "1"
	if secret == "" {
		if !dev {
			return nil, fmt.Errorf("OPENGLASS_JWT_SECRET is required (or set OPENGLASS_DEV_MODE=1)")
		}
		secret = "dev-only-insecure-secret"
	}
	return &Config{
		// :8080 is owned by the TEI embedder in compose — server on :8081
		ListenAddr:        get("OPENGLASS_LISTEN", ":8081"),
		PgDSN:             get("OPENGLASS_PG_DSN", "postgres://openglass:openglass_dev@localhost:5432/openglass"),
		RedisAddr:         get("OPENGLASS_REDIS_ADDR", "localhost:6379"),
		JWTSecret:         []byte(secret),
		AccessTokenTTL:    getDur("OPENGLASS_ACCESS_TTL_S", 900),
		RefreshTokenTTL:   getDur("OPENGLASS_REFRESH_TTL_S", 30*24*3600),
		OtpTTL:            getDur("OPENGLASS_OTP_TTL_S", 600),
		OtpResendCooldown: 60 * time.Second, // contract constant — not configurable
		OtpMaxAttempts:    getInt("OPENGLASS_OTP_MAX_ATTEMPTS", 5),
		DevMode:           dev,
	}, nil
}

func get(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getDur(key string, defS int) time.Duration {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil && v > 0 {
		return time.Duration(v) * time.Second
	}
	return time.Duration(defS) * time.Second
}

func getInt(key string, def int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil && v > 0 {
		return v
	}
	return def
}
