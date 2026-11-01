"""Write examples/output/*.json: the real responses Sniffer gives for the zips in examples/input/.

Run from the repo root after loading and classifying both projects (see backend/README.md):

    backend/.venv/bin/python backend/scripts/export_examples.py

It calls the API in-process against the real database and the local Gemma model (Ollama), as the maintainer
Arin-J26. Nothing is invented here: every file is a response body exactly as the app returned it.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

from app.auth import open_session  # noqa: E402
from app.main import create_app  # noqa: E402

OUT = ROOT / "examples" / "output"
MAINTAINER = "Arin-J26"
REQUESTS = [
    ("health", "GET", "/api/health", None),
    ("dashboard", "GET", "/api/projects", None),
    ("d1-overview", "GET", "/api/projects/d1", None),
    ("d1-trust", "GET", "/api/projects/d1/trust", None),
    ("d2-overview", "GET", "/api/projects/d2", None),
    ("d2-graph", "GET", "/api/projects/d2/graph", None),
    ("d2-trust", "GET", "/api/projects/d2/trust", None),
    ("d2-campaigns", "GET", "/api/projects/d2/campaigns?window_minutes=240&min_size=5", None),
    ("d2-records-test-spam-07", "GET", "/api/projects/d2/records?handle=test-spam-07", None),
    ("d2-evaluate-spam-100", "POST", "/api/projects/d2/evaluate", {"handle": "test-spam-01"}),
    ("d2-evaluate-spam-5", "POST", "/api/projects/d2/evaluate", {"handle": "test-spam-09"}),
    ("d2-evaluate-genuine", "POST", "/api/projects/d2/evaluate", {"handle": "test-genuine-01"}),
    ("d2-evaluate-unknown", "POST", "/api/projects/d2/evaluate", {"handle": "never-seen-before"}),
]


def main() -> None:
    app = create_app()
    if not app.state.llm.available():
        raise SystemExit("Gemma is not running: start Ollama with gemma4:e2b first")
    client = TestClient(app)
    client.cookies.set("sniffer_session", open_session(app.state.db, MAINTAINER))
    OUT.mkdir(parents=True, exist_ok=True)
    for name, method, path, body in REQUESTS:
        r = client.request(method, path, json=body)
        if r.status_code >= 400:
            raise SystemExit(f"{path}: {r.status_code} {r.text[:200]}")
        (OUT / f"{name}.json").write_text(json.dumps(r.json(), indent=2) + "\n")
        print(f"wrote examples/output/{name}.json")


if __name__ == "__main__":
    main()
