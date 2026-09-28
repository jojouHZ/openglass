// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// OpenGlass server — public-layer monolith (REST + WS stub).
// Compose-ready: docker compose up -d postgres redis, then
// OPENGLASS_DEV_MODE=1 go run ./cmd/server
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/jojouHZ/openglass/internal/api"
	"github.com/jojouHZ/openglass/internal/auth"
	"github.com/jojouHZ/openglass/internal/config"
	"github.com/jojouHZ/openglass/internal/store"
	"github.com/jojouHZ/openglass/internal/ws"
)

func main() {
	cfg, err := config.FromEnv()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pg, err := store.NewPG(ctx, cfg.PgDSN)
	if err != nil {
		log.Fatalf("postgres: %v", err)
	}
	defer pg.Close()

	if err := store.Migrate(ctx, pg.Pool()); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	log.Print("migrations applied")

	rdb := redis.NewClient(&redis.Options{Addr: cfg.RedisAddr})
	defer rdb.Close()

	var sender auth.OtpSender = auth.LogSender{}
	if !cfg.DevMode {
		log.Fatal("no production OTP sender yet — set OPENGLASS_DEV_MODE=1")
	}

	srv := api.New(cfg, pg, sender,
		api.WithPgPing(pg.Ping),
		api.WithRedisPing(func(ctx context.Context) error { return rdb.Ping(ctx).Err() }),
	)
	tokens := auth.NewTokens(cfg.JWTSecret, cfg.AccessTokenTTL, cfg.RefreshTokenTTL)
	handler := srv.Handler(ws.Handler(tokens.ParseAccess))

	httpSrv := &http.Server{Addr: cfg.ListenAddr, Handler: handler}
	go func() {
		log.Printf("openglass server listening on %s", cfg.ListenAddr)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("serve: %v", err)
		}
	}()

	<-ctx.Done()
	shCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shCtx)
}
