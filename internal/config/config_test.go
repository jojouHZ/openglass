// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package config

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestCheckWritableDir(t *testing.T) {
	dir := t.TempDir()
	if err := CheckWritableDir(dir); err != nil {
		t.Fatalf("writable dir rejected: %v", err)
	}
	if left, _ := filepath.Glob(filepath.Join(dir, ".write-probe-*")); len(left) != 0 {
		t.Fatalf("probe file left behind: %v", left)
	}
	if err := CheckWritableDir(filepath.Join(dir, "missing")); err == nil {
		t.Fatal("missing dir must fail")
	}
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("permission check needs a non-root unix user")
	}
	ro := filepath.Join(dir, "ro")
	if err := os.Mkdir(ro, 0o500); err != nil {
		t.Fatal(err)
	}
	if err := CheckWritableDir(ro); err == nil {
		t.Fatal("read-only dir (the root-owned volume case) must fail")
	}
}

func TestDemoAccessConfig(t *testing.T) {
	set := func(dev, otp, suffix string) {
		t.Setenv("OPENGLASS_DEV_MODE", dev)
		t.Setenv("OPENGLASS_DEMO_OTP", otp)
		t.Setenv("OPENGLASS_DEMO_EMAIL_SUFFIX", suffix)
		t.Setenv("OPENGLASS_JWT_SECRET", "x")
	}
	// off by default
	set("1", "", "")
	if c, err := FromEnv(); err != nil || c.DemoOTP != "" {
		t.Fatalf("default must be off: %+v %v", c, err)
	}
	// never on a production server
	set("", "123456", "@demo.example.org")
	if _, err := FromEnv(); err == nil {
		t.Fatal("demo access must be refused without dev mode")
	}
	for _, bad := range [][2]string{
		{"12345", "@demo.example.org"},   // too short
		{"12345a", "@demo.example.org"},  // not digits
		{"1234567", "@demo.example.org"}, // too long
		{"123456", ""},                   // no suffix
		{"123456", "demo.example.org"},   // no @
		{"123456", "@x"},                 // not a domain
	} {
		set("1", bad[0], bad[1])
		if _, err := FromEnv(); err == nil {
			t.Fatalf("%v must be rejected", bad)
		}
	}
	set("1", "", "@demo.example.org") // a suffix alone is also a misconfiguration
	if _, err := FromEnv(); err == nil {
		t.Fatal("suffix without a code must be rejected")
	}
	set("1", "424242", "@Demo.Example.ORG")
	c, err := FromEnv()
	if err != nil || c.DemoEmailSuffix != "@demo.example.org" {
		t.Fatalf("valid demo config: %+v %v", c, err)
	}
}

func TestDemoOTPFor(t *testing.T) {
	c := &Config{DemoOTP: "424242", DemoEmailSuffix: "@demo.example.org"}
	for _, tc := range []struct {
		email, code string
		want        bool
	}{
		{"guest1@demo.example.org", "424242", true},
		{"GUEST@Demo.Example.Org", "424242", true},
		{"guest1@demo.example.org", "424243", false}, // wrong code
		{"guest1@demo.example.org", "42424", false},  // wrong length
		{"someone@gmail.com", "424242", false},       // a real inbox is never demo
		{"guest@demo.example.org.evil.com", "424242", false},
		{"guest@evildemo.example.org", "424242", false}, // the suffix starts with @ — no look-alike hosts
	} {
		if got := c.DemoOTPFor(tc.email, tc.code); got != tc.want {
			t.Errorf("%s/%s: got %v want %v", tc.email, tc.code, got, tc.want)
		}
	}
	if (&Config{}).DemoOTPFor("a@b.co", "123456") {
		t.Fatal("zero config must never accept a demo code")
	}
}
