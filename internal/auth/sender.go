// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package auth

import (
	"context"
	"log"
)

// OtpSender — delivery channel for OTP codes. DevMode uses LogSender;
// SMTP/other transports implement the same interface later.
type OtpSender interface {
	SendOtp(ctx context.Context, email, code string) error
}

// LogSender — dev-mode sender: the code lands in server logs.
// Never use outside OPENGLASS_DEV_MODE=1.
type LogSender struct{}

func (LogSender) SendOtp(_ context.Context, email, code string) error {
	log.Printf("[otp] to=%s code=%s", email, code)
	return nil
}

// CaptureSender — test double: records codes without any delivery.
type CaptureSender struct {
	Codes map[string]string // email → last code
}

func NewCaptureSender() *CaptureSender {
	return &CaptureSender{Codes: map[string]string{}}
}

func (c *CaptureSender) SendOtp(_ context.Context, email, code string) error {
	c.Codes[email] = code
	return nil
}
