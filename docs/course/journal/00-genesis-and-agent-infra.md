# Journal 00 — Genesis: product vision and the agent infrastructure

**Phase:** pre-code. Product definition, agent hierarchy, knowledge
infrastructure (Qdrant + TEI + code graph).

## The product bet

OpenGlass is a self-hosted secure messenger for closed communities with
two privacy layers:

- **Public layer** — persistent, server-trusted messaging (the server
  sees plaintext; convenience features like search are possible).
- **Private layer** — ephemeral E2EE with a zero-knowledge relay that
  forwards ciphertext without reading or storing it, and runs without
  Redis.

The architectural consequence that shaped everything later: **the same
in-memory replay/resync mechanism was designed to serve both layers** —
decided before a line of realtime code existed.

## Building the machine that builds the product

Instead of writing features first, the project started with the
development process itself:

- **Agent hierarchy** — 15 role-scoped agents (orchestrator, backend,
  frontend core, security, testing, …) with SKILL.md profiles and a
  hard rule: every task passes owner review before `status:next`.
- **Vector knowledge base** — project docs chunked hierarchically,
  embedded with BGE-large via a TEI service, stored in Qdrant
  (`openglass_docs`, 1024-dim). Refreshed on `type:next`, on rollbacks,
  and on documented bad cases.
- **Code graph** — a continuously indexed symbol/import/call graph
  (Go + Vue/TS indexer, MCP stdio server, `graph.diff`) so agents query
  real structure instead of guessing.

## War stories

- **The Qdrant CI saga.** Five consecutive GitHub Actions failures, each
  documented as a commit message: wrong REST port (6333), a client API
  method that no longer existed (`search` → `query_points`), point IDs
  Qdrant rejects (must be uint64/UUID), a `/health` endpoint that isn't
  one, a missing `curl` in the image. Lesson worth teaching: every
  failure was fixed only after it was *documented* — the bad-case log
  is now queryable memory, not tribal knowledge.
- **Public surface discipline.** Internal tooling (`.devin/`,
  `AGENTS.md`, codegraph, agent test scripts) is gitignored — the repo
  publishes the product, not the machinery.

## Why this ordering mattered

When feature work began, every agent already had: a queryable spec
corpus, a structural map of the code, and a review protocol. The
contract-first phase that followed was cheap *because* the
infrastructure existed to keep eight contract revision rounds coherent.
