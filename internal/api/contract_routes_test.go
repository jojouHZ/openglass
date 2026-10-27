// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package api_test

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

var (
	routeRe  = regexp.MustCompile(`(?:v1|mux)\.Handle(?:Func)?\("([A-Z]+) (/[^"]*)"`)
	paramRe  = regexp.MustCompile(`\{[^}]+\}`)
	pathRe   = regexp.MustCompile(`^  (/[^:\s]*):\s*$`)
	methodRe = regexp.MustCompile(`^    (get|post|put|patch|delete):\s*$`)
)

func norm(method, path string) string {
	return strings.ToUpper(method) + " " + paramRe.ReplaceAllString(path, "{}")
}

// registeredRoutes reads the router's route table from server.go (a
// ServeMux cannot be enumerated at runtime).
func registeredRoutes(t *testing.T) map[string]bool {
	t.Helper()
	src, err := os.ReadFile("server.go")
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]bool{}
	for _, m := range routeRe.FindAllStringSubmatch(string(src), -1) {
		out[norm(m[1], m[2])] = true
	}
	return out
}

func contractRoutes(t *testing.T) map[string]bool {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "docs", "api", "public-api.openapi.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]bool{}
	var cur string
	inPaths := false
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "paths:") {
			inPaths = true
			continue
		}
		if inPaths && len(line) > 0 && line[0] != ' ' && line[0] != '#' {
			break // components: …
		}
		if m := pathRe.FindStringSubmatch(line); m != nil {
			cur = m[1]
		} else if m := methodRe.FindStringSubmatch(line); m != nil && cur != "" {
			out[norm(m[1], cur)] = true
		}
	}
	return out
}

// The router and the contract must describe the same API: a route that is
// only in the contract is a stub waiting to happen; a route that is only in
// the router is undocumented surface.
func TestRouterMatchesContract(t *testing.T) {
	routes, spec := registeredRoutes(t), contractRoutes(t)
	if len(routes) < 40 || len(spec) < 40 {
		t.Fatalf("parsers found too little (router %d, contract %d) — update the regexes", len(routes), len(spec))
	}
	// WebSocket upgrade endpoints are specified in docs/api/ws-events.md and
	// docs/api/relay-events.md, not in the OpenAPI document
	delete(routes, "GET /ws")
	delete(routes, "GET /relay")
	var onlyRouter, onlySpec []string
	for r := range routes {
		if !spec[r] {
			onlyRouter = append(onlyRouter, r)
		}
	}
	for r := range spec {
		if !routes[r] {
			onlySpec = append(onlySpec, r)
		}
	}
	sort.Strings(onlyRouter)
	sort.Strings(onlySpec)
	if len(onlyRouter) > 0 {
		t.Errorf("routes missing from the contract: %v", onlyRouter)
	}
	if len(onlySpec) > 0 {
		t.Errorf("contract paths with no route (a stub in waiting): %v", onlySpec)
	}
}

// F4 north star: nothing in the server answers "not implemented".
func TestNoNotImplementedAnywhere(t *testing.T) {
	var hits []string
	_ = filepath.Walk(filepath.Join("..", "..", "internal"), func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			return nil
		}
		b, _ := os.ReadFile(p) // #nosec G122 G304 — test walks our own source tree
		if strings.Contains(string(b), "StatusNotImplemented") || strings.Contains(string(b), `"not_implemented"`) {
			hits = append(hits, p)
		}
		return nil
	})
	if len(hits) > 0 {
		t.Fatalf("a stub crept back in: %v", hits)
	}
}
