# Code Graph Integration Plan (graphify)

Status: in progress (milestone 1 done) · Owner: Knowledge Agent ·
Scope: pre-development infrastructure, alongside Qdrant.

## Goal

Give every agent a live, queryable map of the codebase — symbols,
imports, calls, contracts — so that Orchestrator/Task Agent/Code Review
always reason over current structure, not stale docs.

Complements Qdrant: Qdrant = semantic search over prose docs and
decisions ("why"), code graph = exact structural truth ("what calls
what", "what is the signature").

## Architecture

```
source files (Go, TS, Vue)
        │
        ▼
  tree-sitter indexers          ← incremental, on file save / pre-commit
        │
        ▼
  graph store                   ← SQLite + JSON export (MVP) · Neo4j (later)
        │
        ▼
  MCP server "openglass-graph"  ← query API for agents
        │
        ▼
  agents (orchestrator, task, code-review, backend, frontend…)
```

## Node / edge model

Nodes:
- `file` — path, module, package, LOC, hash
- `symbol` — function/method/type/interface/component/props/store action
- `contract` — API endpoint (method+path), WS event name, message DTO
- `test` — spec/case linked to covered symbols

Edges:
- `imports`, `calls`, `implements`, `exposes` (contract → handler),
  `emits`/`listens` (WS events), `renders` (Vue component tree),
  `defines` (file → symbol), `tests` (test → symbol)

This gives us contract tracing for free: REST endpoint → handler →
service → repo → DB model; WS event → producer/consumer pairs.

## Stack

- Parsers: tree-sitter (go, typescript, vue via vue-sfc split).
- Storage MVP: SQLite (`nodes`, `edges` tables) + `codegraph.json`
  export for tooling/CI. Neo4j only if queries outgrow SQL —
  don't add a graph DB before we need it.
- Server: small Go MCP service (`cmd/codegraph`) exposing tools:
  `symbol.find`, `symbol.refs`, `contract.trace`, `impact.of(path)`,
  `module.deps`, `graph.diff`.

## Update pipeline

1. `make graph` / watcher: re-parse changed files (hash-based).
2. Pre-commit hook or CI step: incremental re-index, fail if graph
   build breaks.
3. On `status:next` (task approved): full refresh + snapshot into
   Qdrant-facing summary so Knowledge Agent docs stay in sync.

## Agent usage

- Orchestrator — decompose tasks by `module.deps` / `impact.of` before
  assigning.
- Task Agent — attach affected files/symbols to GitHub issues
  automatically.
- Backend/Frontend — `contract.trace` to see both ends of an endpoint/
  event before changing a signature.
- Code Review — `graph.diff` between branch and main: new/changed
  symbols, broken edges, untested symbols.
- Testing — coverage map: symbols without `tests` edges.

## Current implementation (milestones 1–2)

`cmd/codegraph` + `internal/codegraph` (local-only per `.gitignore`):

```
codegraph index  -root . -json .codegraph/codegraph.json
codegraph stats                    # node/edge counts by kind
codegraph find   '%Send%'          # symbol.find equivalent
codegraph refs   'sym:<pkg>.<Fn>'  # incoming edges (symbol.refs)
codegraph deps   'file:<path>'     # outgoing edges
codegraph export -out file.json
codegraph serve                    # MCP stdio server (openglass-graph)
```

MCP server (`serve` subcommand) speaks newline-delimited JSON-RPC 2.0
on stdio and exposes six tools: `symbol.find`, `symbol.refs`,
`symbol.deps`, `contract.trace` (call-chain BFS, up/downstream),
`impact.of` (reverse reachability), `module.deps` (dir-level import
aggregation). Registered for Devin in `.devin/mcp_config.json`
(stdio via `wsl -e .codegraph/codegraph serve`). Rebuild the binary
after changes: `go build -o .codegraph/codegraph ./cmd/codegraph`.

Go extractor covers: packages, imports (internal resolved to files,
external kept as `ext:` stub nodes), functions, methods (receiver-
qualified ids), types/interfaces, vars/consts, test entrypoints
(`*_test.go` + Test/Benchmark/Example/Fuzz), and call sites resolved
through a package-level symbol table. Nodes: `file`, `symbol`.
Edges: `defines`, `imports`, `calls`. Artifacts live in `.codegraph/`
(SQLite db + JSON export), gitignored.

## Milestones

1. ~~Indexer MVP: Go backend only → symbols/imports/calls into SQLite.~~ ✅
2. ~~MCP server with `symbol.find` + `symbol.refs` + `contract.trace`~~ ✅
   (also `symbol.deps`, `impact.of`, `module.deps`)
3. Vue/TS indexer (components, props, emits, stores, routes).
4. `graph.diff` for code review + `impact.of` for orchestrator.
5. CI: graph freshness check; optional Neo4j migration.

## Open questions

- Keep graph in-repo (`codegraph.json` committed) or build artifact?
  Proposal: artifact in CI, committed snapshot weekly for agents.
- Private-layer crypto/session contracts: index but flag sensitive
  edges so Security Agent reviews them explicitly.
