# Copyright (C) 2025 OpenGlass contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Minimal TEI-compatible /embed endpoint backed by sentence-transformers.

ghcr.io may be unreachable on some networks, so the huggingface
text-embeddings-inference container is optional. This shim emulates the
single endpoint our tooling needs (POST /embed, {"inputs": [...]}) with
BGE-large running locally on CPU.

Run: .venv-kb/bin/python scripts/tei_shim.py [port]   (default 8085)
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_NAME = "BAAI/bge-large-en-v1.5"
_model = None


def model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer

        _model = SentenceTransformer(MODEL_NAME)
    return _model


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path.rstrip("/") != "/embed":
            self.send_error(404)
            return
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        inputs = body.get("inputs") or []
        vecs = model().encode(inputs, normalize_embeddings=False).tolist()
        data = json.dumps(vecs).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8085
    print(f"TEI shim on :{port}, model {MODEL_NAME}", flush=True)
    model()  # preload so the first request is not the slow one
    print("model ready", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
