# AI-Assisted Development Workflow

OpenGlass is developed with an AI-assisted workflow built around a persistent
**project knowledge base**. This document describes the public architecture of
that system — what it does and why. Internal configuration is private.

## Why

Software projects lose context: decisions are made, mistakes are fixed, lessons
are learned — then forgotten. This workflow makes project memory a first-class
artifact: every significant event is documented, vectorized, and searchable.

## Knowledge Pipeline (RAG)

```
Markdown docs (docs/)
        │
        ▼
Hierarchical chunking            scripts/vectorize_docs.py
(sections → subsections →        runs locally and in CI
 paragraphs, keeps context)
        │
        ▼
BGE-large embeddings             BAAI/bge-large-en-v1.5
(1024-dimensional vectors)       via sentence-transformers / TEI
        │
        ▼
Qdrant vector DB                 collection: openglass_docs
        │                        REST :6333 / gRPC :6334
        ▼
Semantic search                  filtered by payload metadata
```

## Knowledge Categories

The knowledge base is organized by document type so queries can be filtered
by intent:

| Category | Contents | Purpose |
|----------|----------|---------|
| `architecture` | System design docs (`docs/architecture/`) | Current source of truth |
| `success_case` | `docs/success_cases/` | Proven approaches worth repeating |
| `bad_case` | `docs/bad_cases/` | Failures with root causes — never repeat |
| `rollback` | `docs/rollbacks/` | Reverted decisions and why |
| `general` | README, other docs | Project overview |

Each chunk carries metadata (`source_file`, `section`, `case_type`, `level`,
`file_hash`) enabling precise filtered retrieval.

## Continuous Vectorization

A GitHub Actions workflow re-indexes documentation on every change to
`docs/` — the knowledge base is always current. The pipeline validates itself:
it runs a live search query after indexing to prove the round-trip works.

Local stack for development: Qdrant + a TEI (text-embeddings-inference)
service, both in `docker-compose.yml`.

## Task Workflow (Kanban)

Work is tracked publicly through GitHub Issues, labels and a Project board:

```
backlog → proceed → done → approved → next
                        ↘ blocked
```

- `proceed` — task is being worked on
- `done` — implementation finished, awaiting review
- `approved` — passed review
- `next` — accepted, feeds the knowledge base refresh

Every transition is human-gated: nothing advances without owner review.

## What Stays Private

The public repo contains the pipeline (`scripts/vectorize_docs.py`, the CI
workflow, compose stack) and the indexed documentation itself. The internal
configuration of the AI-assisted workflow — agent definitions, orchestration
rules, and operational settings — is intentionally kept out of the repository.
This document describes the system at the architectural level; the mechanics
are the implementation.

## For Teams Interested in This Setup

The same pattern transfers to any repository: docs-as-knowledge + vector
search + kanban-gated automation. The components here (Qdrant, BGE embeddings,
GitHub Actions) are off-the-shelf; the value is in the structure — strict
knowledge categories, CI-validated indexing, and review gates that keep a
human in control.
