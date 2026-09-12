# Success Case: Go + Qdrant + TEI Search Pipeline

## Summary
Implemented real end-to-end semantic search from Go: query → TEI embedder (BGE-large, 1024-dim) → Qdrant gRPC search → filtered results.

## Architecture

```
Go client → POST /embed (TEI, port 8080) → 1024-dim vector
          → gRPC SearchPoints (Qdrant, port 6334) → ContextResult[]
```

## What worked

- **TEI (text-embeddings-inference)** as embedding microservice — same `BAAI/bge-large-en-v1.5` model as the Python indexer, so vectors are compatible. CPU image `ghcr.io/huggingface/text-embeddings-inference:cpu-latest`.
- **qdrant/go-client v1.7.0** uses generated gRPC clients: `pb.NewPointsClient(conn)`, `pb.NewCollectionsClient(conn)`. The package declares itself `go_client` — import with alias `pb`.
- **Payload filters** via `pb.Filter{Must: []*pb.Condition{...}}` with `Match_Keyword` — role and case-type filtering work correctly.
- **Named Docker volumes** instead of bind mounts — Docker Desktop can't mount WSL paths without WSL integration enabled.

## Verified results

- `GetContextForAgent("backend", "websocket security")` → matching skill-doc chunks (score 0.72-0.74)
- `GetSuccessCases("authentication implementation")` → websocket_implementation.md (score 0.70)
- `GetBadCases("memory management")` → memory_leak.md (score 0.68)

## Key lessons

- Check the actual package clause in third-party generated code — `github.com/qdrant/go-client/qdrant` is `package go_client`, not `qdrant`.
- Qdrant point IDs must be uint64 or UUID — arbitrary strings are rejected.
- Always propagate errors to exit codes in CI scripts; swallowed errors create false-green pipelines.
- GPU OOM in WSL: `CUDA_VISIBLE_DEVICES=''` forces CPU for local indexing.

## Related commits
- `687c7ae` Fix Go client for qdrant go-client v1.7 generated gRPC API
