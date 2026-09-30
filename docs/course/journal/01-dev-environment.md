# Journal 01 — Dev environment bring-up: WSL, Go toolchain, IDE remote

**Phase:** environment setup before feature code (Sept 24). Deps,
docker services, Go upgrade, and making the IDE actually work inside
WSL — recovered from the `cooing-gargoyle` session transcript.

## What was set up

- **Backend deps** (from `docs/success_cases` choices, not guesses):
  `gorilla/websocket` (WS hub), `pgx` (PostgreSQL), `go-redis`,
  `x/crypto` (token hashing), pinned to released versions.
- **Compose services** — PostgreSQL + Redis added and verified live.
- **pnpm 11** — corepack couldn't write to `/usr/bin`; installed to
  `~/bin` instead.
- **Go 1.27.1** — upgraded in-place at `~/sdk/go` via the official
  tarball; nothing in PATH had to change.

## War stories — the debuggable kind

1. **`.venv` leaked into the code graph.** An abandoned virtualenv was
   indexed: site-packages files and unpkg imports landed in the DB.
   Fix: add `.venv` to `skipDirs`, reindex (270 files → clean diff).
   Indexers need exclusion lists *before* the first run.
2. **Go proxy flakiness in WSL.** `go get` kept dying on EOF from
   `proxy.golang.org`/sum DB — metadata loaded, zips failed (MTU/proxy
   shaped traffic). Fixes used in order: retry → `goproxy.cn` mirror →
   `GOPROXY=direct`. Side lesson: a failed `go get` can leave `go.mod`
   half-rewritten — always verify the file state after a network
   failure, not just the command's exit.
3. **Version pinning is a ratchet.** `pgx v5.9` and `x/crypto v0.55`
   require go ≥ 1.25 — on go1.23 the correct move was older compatible
   versions, then upgrade the toolchain once and take fresh deps.
   Read the *minimum toolchain* line before blaming the network.
4. **IDE diagnostics can be environment bugs.** gopls reported
   "no active builds contain ...\index.go" — the code was fine; the
   language server ran on Windows while files lived at
   `\\wsl$\Ubuntu-24.04\...`. Drive-mapping didn't help: Windows-Go
   can't lock `go.mod` on the 9p filesystem (`RLock: Incorrect
   function`). The real fix was `windsurf-remote-wsl` — run the
   extensions *inside* WSL, plus `gopls` installed in WSL and PATH
   exported in `.profile`.
5. **Heredoc escaping through nested shells.** Writing `.profile`
   through `wsl bash -c '...'` twice-removed `$` escapes and baked
   garbage into the file. Rule: for multi-line file writes, use a file
   tool — not a shell nested two levels deep.

## Why it's in the course

Environment bring-up is where junior setups silently rot. Every fix
above is a generalizable skill: exclusion lists, proxy fallbacks,
minimum-toolchain reading, "is the diagnostic about the code or the
runtime", and shell-escaping discipline.
