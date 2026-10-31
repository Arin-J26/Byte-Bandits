"""SQLite storage (stdlib sqlite3). Parameterized queries only.

Records are append-only: there is no update or delete for a single record. Loading a simulated
or imported network replaces the whole dataset, which is a reset rather than an edit.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parent.parent / "sniffer.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  private_key TEXT,               -- simulation/dev only, never returned by the API
  max_depth INTEGER NOT NULL DEFAULT 3,
  decay REAL                      -- NULL: use the server default
);
CREATE TABLE IF NOT EXISTS trust_edges (
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  weight REAL NOT NULL,
  PRIMARY KEY (src, dst)
);
CREATE TABLE IF NOT EXISTS records (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  issuer TEXT NOT NULL,
  subject_handle TEXT NOT NULL,
  type TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_urls TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  signature TEXT NOT NULL,
  signature_valid INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pr_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  account_age_days INTEGER NOT NULL,
  title TEXT NOT NULL,
  body_excerpt TEXT NOT NULL,
  diff_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_records_subject ON records(subject_handle);
"""


def db_path_from_env() -> Path:
    return Path(os.environ.get("SNIFFER_DB", str(DEFAULT_DB)))


class Database:
    """Thin wrapper; a fresh connection per operation keeps background threads safe."""

    def __init__(self, path: str | Path | None = None):
        self.path = Path(path) if path else db_path_from_env()
        self._write_lock = threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as con:
            con.executescript(SCHEMA)
            cols = {r["name"] for r in con.execute("PRAGMA table_info(projects)")}
            if "decay" not in cols:  # databases created before per-project decay existed
                con.execute("ALTER TABLE projects ADD COLUMN decay REAL")

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        con = sqlite3.connect(self.path, timeout=10)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA journal_mode=WAL")
        try:
            yield con
            con.commit()
        finally:
            con.close()

    # ---------- reads ----------
    def projects(self) -> list[dict]:
        with self.connect() as con:
            return [
                dict(r)
                for r in con.execute("SELECT id, name, public_key, max_depth, decay FROM projects ORDER BY rowid")
            ]

    def project(self, project_id: str) -> dict | None:
        with self.connect() as con:
            row = con.execute(
                "SELECT id, name, public_key, max_depth, decay FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            return dict(row) if row else None

    def private_key(self, project_id: str) -> str | None:
        """Dev/simulation helper for signing; never exposed through an endpoint."""
        with self.connect() as con:
            row = con.execute("SELECT private_key FROM projects WHERE id = ?", (project_id,)).fetchone()
            return row["private_key"] if row else None

    def edges(self) -> list[dict]:
        with self.connect() as con:
            rows = con.execute("SELECT src, dst, weight FROM trust_edges ORDER BY rowid")
            return [{"from": r["src"], "to": r["dst"], "weight": r["weight"]} for r in rows]

    def records(self) -> list[dict]:
        with self.connect() as con:
            rows = con.execute(
                "SELECT id, issuer, subject_handle, type, reason, evidence_urls, timestamp, signature, signature_valid "
                "FROM records ORDER BY seq"
            )
            return [_record_row(r) for r in rows]

    def pr_events(self) -> list[dict]:
        with self.connect() as con:
            rows = con.execute(
                "SELECT id, project_id, handle, account_age_days, title, body_excerpt, diff_text, created_at "
                "FROM pr_events ORDER BY created_at"
            )
            return [dict(r) for r in rows]

    # ---------- writes ----------
    def set_project_settings(self, project_id: str, max_depth: int, decay: float | None) -> None:
        with self._write_lock, self.connect() as con:
            con.execute("UPDATE projects SET max_depth = ?, decay = ? WHERE id = ?", (max_depth, decay, project_id))

    def upsert_edge(self, src: str, dst: str, weight: float) -> None:
        with self._write_lock, self.connect() as con:
            con.execute(
                "INSERT INTO trust_edges (src, dst, weight) VALUES (?, ?, ?) "
                "ON CONFLICT(src, dst) DO UPDATE SET weight = excluded.weight",
                (src, dst, weight),
            )

    def insert_record(self, rec: dict, signature_valid: bool) -> None:
        with self._write_lock, self.connect() as con:
            con.execute(
                "INSERT INTO records (id, issuer, subject_handle, type, reason, evidence_urls, timestamp, signature, "
                "signature_valid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                _record_params(rec, signature_valid),
            )

    def record_exists(self, record_id: str) -> bool:
        with self.connect() as con:
            return con.execute("SELECT 1 FROM records WHERE id = ?", (record_id,)).fetchone() is not None

    def replace_network(self, net: dict) -> None:
        """Replace all network data in one transaction (simulate/load and network/import)."""
        with self._write_lock, self.connect() as con:
            for table in ("projects", "trust_edges", "records", "pr_events"):
                con.execute(f"DELETE FROM {table}")  # noqa: S608 - fixed table names, no user input
            con.executemany(
                "INSERT INTO projects (id, name, public_key, private_key, max_depth, decay) VALUES (?, ?, ?, ?, ?, ?)",
                [
                    (p["id"], p["name"], p["public_key"], p.get("private_key"), p.get("max_depth", 3), p.get("decay"))
                    for p in net["projects"]
                ],
            )
            con.executemany(
                "INSERT INTO trust_edges (src, dst, weight) VALUES (?, ?, ?)",
                [(e["from"], e["to"], e["weight"]) for e in net["trust_edges"]],
            )
            con.executemany(
                "INSERT INTO records (id, issuer, subject_handle, type, reason, evidence_urls, timestamp, signature, "
                "signature_valid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [_record_params(r, r["signature_valid"]) for r in net["records"]],
            )
            con.executemany(
                "INSERT INTO pr_events (id, project_id, handle, account_age_days, title, body_excerpt, diff_text, "
                "created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        e["id"],
                        e["project_id"],
                        e["handle"],
                        e["account_age_days"],
                        e["title"],
                        e["body_excerpt"],
                        e["diff_text"],
                        e["created_at"],
                    )
                    for e in net.get("pr_events", [])
                ],
            )

    def is_empty(self) -> bool:
        with self.connect() as con:
            return con.execute("SELECT COUNT(*) FROM projects").fetchone()[0] == 0

    # ---------- LLM cache ----------
    def cache_get(self, key: str) -> str | None:
        with self.connect() as con:
            row = con.execute("SELECT value FROM llm_cache WHERE key = ?", (key,)).fetchone()
            return row["value"] if row else None

    def cache_put(self, key: str, value: str) -> None:
        with self._write_lock, self.connect() as con:
            con.execute("INSERT OR REPLACE INTO llm_cache (key, value) VALUES (?, ?)", (key, value))


def _record_params(rec: dict, signature_valid: bool) -> tuple:
    return (
        rec["id"],
        rec["issuer"],
        rec["subject_handle"],
        rec["type"],
        rec["reason"],
        json.dumps(list(rec.get("evidence_urls", []))),
        rec["timestamp"],
        rec["signature"],
        int(bool(signature_valid)),
    )


def _record_row(r: sqlite3.Row) -> dict:
    d = dict(r)
    d["evidence_urls"] = json.loads(d["evidence_urls"])
    d["signature_valid"] = bool(d["signature_valid"])
    return d
