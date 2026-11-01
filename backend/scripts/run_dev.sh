#!/usr/bin/env bash
# Run Sniffer (API + frontend) on http://localhost:8000 with auto-reload.
# Creates backend/.venv on first run. Needs Python 3.11+; Ollama with gemma4:e2b is optional.
set -euo pipefail
BACKEND="$(cd "$(dirname "$0")/.." && pwd)"
PY="${PYTHON:-python3}"
if [ ! -x "$BACKEND/.venv/bin/uvicorn" ]; then
  "$PY" -m venv "$BACKEND/.venv"
  "$BACKEND/.venv/bin/pip" install -q --upgrade pip
  "$BACKEND/.venv/bin/pip" install -q -e "$BACKEND[dev]"
fi
if ! curl -s -m 2 "${OLLAMA_HOST:-http://localhost:11434}/api/tags" >/dev/null; then
  echo "Ollama is not reachable: Sniffer still works, with deterministic summaries (ai=false)."
fi
cd "$BACKEND/.."
if [ -f "$BACKEND/.env" ]; then  # optional local settings, see backend/.env.example
  set -a; . "$BACKEND/.env"; set +a
  [ -n "${GITHUB_TOKEN:-}" ] || unset GITHUB_TOKEN
fi
exec "$BACKEND/.venv/bin/uvicorn" app.main:app --app-dir backend --host 127.0.0.1 --port "${PORT:-8000}" --reload \
  --reload-dir backend/app
