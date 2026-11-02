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
