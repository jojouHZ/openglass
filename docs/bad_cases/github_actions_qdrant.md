# Bad Case: GitHub Actions Qdrant Service Failures

## Summary
The `vectorize_docs.yml` workflow failed twice before succeeding.

## Failure 1: Timeout (exit code 124)
**Cause:** `docker run -d qdrant/qdrant` executed manually inside a step, plus the BGE-large model (~1.3GB) downloaded on every run. The job hit the default timeout.

**Fix:**
- Moved Qdrant to a `services:` block so Actions manages the container lifecycle.
- Added `actions/cache` for `~/.cache/huggingface` so the embedding model downloads once.
- Added `timeout-minutes: 15` to the job.

## Failure 2: Initialize containers
**Cause:** The service `options:` block defined a Docker health check using `curl`. The `qdrant/qdrant` image is minimal and does not ship `curl`, so the container never became healthy and the job failed at container initialization.

**Fix:** Removed the `options:` health check entirely. Readiness is handled by the explicit `Wait for Qdrant to be ready` step, which runs `curl` on the runner (where it exists).

## Failure 3: Wait for Qdrant to be ready
**Cause:** The readiness check polled `http://localhost:6333/health`, which Qdrant does not expose (it has `/healthz`/`/readyz`, version-dependent). `curl -f` got 404 for 60s and the step timed out.

**Fix:** Poll the root endpoint `http://localhost:6333/` instead — it returns 200 on every Qdrant version once the HTTP server is up.

## Lessons
- Prefer `services:` over manual `docker run` in GitHub Actions.
- Never assume common CLI tools (`curl`, `bash`) exist inside third-party minimal images.
- Cache large ML model downloads; embedding models are too big to fetch per-run.
- Workflow file changes alone do not retrigger path-filtered workflows — use `workflow_dispatch` or a docs commit to test.

## Related commits
- `2a0390e` Fix GitHub Actions: use services for Qdrant and cache HuggingFace models
- `97c3b3e` Remove container health check - qdrant image lacks curl
- `40cef82` Fix Qdrant readiness check - use root endpoint instead of /health
