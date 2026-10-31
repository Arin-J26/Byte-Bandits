# AGENTS.md

Rules for AI coding assistants working on the Sniffer backend.

- **Git:** do not run `git add`, `commit`, `push` or any `gh` command, and do not open PRs unless the user explicitly asks. Only create or edit files.
- **Scope:** work only in `backend/` (plus `docs/API.md`, `examples/`, this file and README sections).
- **Stack:** Python 3.11+, FastAPI, Uvicorn, SQLite (stdlib `sqlite3`), PyNaCl, datasketch, the `ollama` package, pytest, httpx, ruff. Dependencies live in `backend/pyproject.toml`.
- **Model:** the only AI model is `gemma4:e2b`, served by Ollama at http://localhost:11434 (name from `SNIFFER_MODEL`). Never import or call any cloud AI SDK or API, not even as a fallback. No secrets, no API keys, no posting to real GitHub. Synthetic data only.
- **Model use:** all model calls and prompts live in `backend/app/llm.py`. Wrap every contributor-controlled string in `<data>…</data>` after cleaning and truncating it. If Ollama is unreachable, return deterministic text with `ai: false` and never crash.
- **Decisions:** the trust engine (`backend/app/trust.py`) is pure and deterministic. The model never makes or changes a decision.
- **Records:** records are signed with ed25519 over canonical JSON and are append-only. A denounce needs at least one evidence URL. Private keys are never returned by any endpoint.
- **API:** the API is under `/api` and returns exactly the shapes in `frontend/mock/*.json`; `docs/API.md` wins if it differs. The frontend is mounted as static files last.
- **Database:** use parameterized queries only. The DB path comes from `SNIFFER_DB` (default `backend/sniffer.db`, git-ignored).
- **Tests:** keep `ruff check backend` and `pytest backend` green. Tests must not need Ollama; real-model tests use the `live` marker and run only with `SNIFFER_LIVE=1`.
