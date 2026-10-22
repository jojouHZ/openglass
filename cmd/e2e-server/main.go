// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// E2E server — in-memory OpenGlass backend seeded with two mutual users.
//
// This binary is *only* for the Playwright two-client E2E suite. It starts
// on a free port, writes a JSON seed file, and blocks until killed. PG and
// Redis are bypassed by store.NewMem(), so the suite has no Docker deps.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/jojouHZ/openglass/internal/api"
	"github.com/jojouHZ/openglass/internal/auth"
	"github.com/jojouHZ/openglass/internal/config"
	"github.com/jojouHZ/openglass/internal/relay"
	"github.com/jojouHZ/openglass/internal/store"
	"github.com/jojouHZ/openglass/internal/ws"
)

type seedUser struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	DisplayName  string `json:"displayName"`
	Tag          string `json:"tag"`
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	SessionID    string `json:"sessionId"`
}

type seedOutput struct {
	APIURL string              `json:"apiUrl"`
	ChatID string              `json:"chatId"`
	Users  map[string]seedUser `json:"users"`
}

func main() {
	addr := flag.String("addr", "127.0.0.1:0", "listen address (:0 for ephemeral)")
	stateFile := flag.String("state", "", "path to write seed JSON")
	flag.Parse()

	cfg := &config.Config{
		ListenAddr:        *addr,
		JWTSecret:         []byte("e2e-dev-only-secret-do-not-use-elsewhere"),
		AccessTokenTTL:    24 * time.Hour,
		RefreshTokenTTL:   24 * time.Hour,
		OtpTTL:            600 * time.Second,
		OtpResendCooldown: 60 * time.Second,
		OtpMaxAttempts:    5,
		DevMode:           true,
		UploadsDir:        "data/uploads-e2e",
	}
	if err := os.MkdirAll(cfg.UploadsDir, 0o750); err != nil {
		log.Fatalf("uploads dir: %v", err)
	}

	st := store.NewMem()
	tokens := auth.NewTokens(cfg.JWTSecret, cfg.AccessTokenTTL, cfg.RefreshTokenTTL)

	seedDefs := []struct {
		tag, email, name string
	}{
		{"alice", "alice@e2e.local", "Alice"},
		{"bob", "bob@e2e.local", "Bob"},
		{"carol", "carol@e2e.local", "Carol"}, // no relationship: consent flow specs
	}
	users := make(map[string]seedUser, len(seedDefs))
	ids := make([]string, 0, len(seedDefs))
	for _, d := range seedDefs {
		u, err := st.CreateUser(context.Background(), d.email)
		if err != nil {
			log.Fatalf("create user %s: %v", d.tag, err)
		}
		u, err = st.CompleteProfile(context.Background(), u.ID, d.name, d.tag)
		if err != nil {
			log.Fatalf("complete profile %s: %v", d.tag, err)
		}
		ids = append(ids, u.ID)
		users[d.tag] = seedUser{
			ID:          u.ID,
			Email:       d.email,
			DisplayName: d.name,
			Tag:         d.tag,
		}
	}

	// mutual contacts are required for OpenDirectChat and for the relay
	// contact-gating that prevents spam private invitations
	if _, err := st.RequestContact(context.Background(), ids[0], ids[1]); err != nil {
		log.Fatalf("add contact alice->bob: %v", err)
	}
	if _, err := st.RequestContact(context.Background(), ids[1], ids[0]); err != nil {
		log.Fatalf("add contact bob->alice: %v", err)
	}

	chat, _, err := st.OpenDirectChat(context.Background(), ids[0], ids[1])
	if err != nil {
		log.Fatalf("open direct chat: %v", err)
	}

	// sessions + token pairs for the two E2E browser contexts
	for _, d := range seedDefs {
		su := users[d.tag]
		sess, err := st.CreateSession(context.Background(), su.ID, "e2e", []byte{})
		if err != nil {
			log.Fatalf("create session %s: %v", d.tag, err)
		}
		pair, err := tokens.NewPair(su.ID, sess.ID)
		if err != nil {
			log.Fatalf("new token pair %s: %v", d.tag, err)
		}
		su.SessionID = sess.ID
		su.AccessToken = pair.AccessToken
		su.RefreshToken = pair.RefreshToken
		users[d.tag] = su
	}

	hub := ws.NewHub(tokens.ParseAccess, st)
	rl := relay.New(tokens.ParseAccess, st)
	srv := api.New(cfg, st, auth.LogSender{},
		api.WithPgPing(func(context.Context) error { return nil }),
		api.WithRedisPing(func(context.Context) error { return nil }),
		api.WithHub(hub),
		api.WithRelay(rl),
	)
	handler := srv.Handler(hub.ServeHTTP)

	lis, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Fatalf("listen: %v", err)
	}
	httpSrv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		if err := httpSrv.Serve(lis); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("serve: %v", err)
		}
	}()

	out := seedOutput{
		APIURL: "http://" + lis.Addr().String(),
		ChatID: chat.ID,
		Users:  users,
	}
	raw, err := json.Marshal(out)
	if err != nil {
		log.Fatalf("marshal seed: %v", err)
	}
	if *stateFile != "" {
		if err := os.WriteFile(*stateFile, raw, 0o600); err != nil {
			log.Fatalf("write state file: %v", err)
		}
	}
	fmt.Println(string(raw))
	fmt.Println("E2E_SERVER_READY")

	// block forever; the E2E runner kills this process
	select {}
}
