"""Background Gemma classification of a project's pull requests, with progress for the UI.

Runs one job per project at a time in a worker thread, so requests stay fast. Each PR is classified once and
the answer is stored; a second run only touches PRs still unclassified.
"""

from __future__ import annotations

import logging
import threading
from datetime import UTC, datetime

from .db import Database
from .llm import LLM

log = logging.getLogger("sniffer.jobs")
_lock = threading.Lock()
_state: dict[str, dict] = {}


def status(project_id: str) -> dict:
    return dict(_state.get(project_id, {"state": "idle", "done": 0, "total": 0, "ai_failures": 0}))


def start(db: Database, llm: LLM, project_id: str) -> dict:
    with _lock:
        if _state.get(project_id, {}).get("state") == "running":
            return status(project_id)
        pending = db.pending(project_id)
        _state[project_id] = {
            "state": "running",
            "done": 0,
            "total": len(pending),
            "ai_failures": 0,
            "started_at": datetime.now(UTC).isoformat(),
        }
    threading.Thread(target=_run, args=(db, llm, project_id, pending), daemon=True).start()
    return status(project_id)


def _run(db: Database, llm: LLM, project_id: str, pending: list[dict]) -> None:
    try:
        for pr in pending:
            verdict, ai = llm.classify_pr(pr)
            if verdict is None:
                db.save_classification(
                    pr["id"], "unclassified", "Gemma could not classify this PR (model offline or unclear).", False
                )
                _state[project_id]["ai_failures"] += 1
            else:
                label = "spam" if verdict.spam else "genuine"
                db.save_classification(pr["id"], label, verdict.reason if verdict.spam else "", True)
            _state[project_id]["done"] += 1
    except Exception:  # noqa: BLE001 - never leave the UI stuck in "running"
        log.exception("classification failed for %s", project_id)
        _state[project_id]["state"] = "failed"
        return
    _state[project_id]["state"] = "done"
