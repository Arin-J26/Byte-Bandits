"""SQLite storage (stdlib sqlite3). Parameterized queries only.

Everything here comes from the user: maintainer accounts, projects uploaded as zip files, their pull requests,
and Gemma's classifications. There is no synthetic data.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parent.parent / "sniffer.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  login TEXT PRIMARY KEY,               -- GitHub login, verified to exist when the account is created
  salt TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  login TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  github TEXT NOT NULL,                 -- "owner/repo" on GitHub
  maintainers TEXT NOT NULL,            -- JSON list of GitHub logins allowed to open this project
  uploaded_by TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',      -- where the project came from (zip name, PR source)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS decisions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  handle TEXT NOT NULL,                 -- lower-case GitHub login
  action TEXT NOT NULL,                 -- 'block' | 'accept'; set only by a maintainer, never automatically
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, handle)
);
CREATE TABLE IF NOT EXISTS prs (
  id TEXT PRIMARY KEY,                  -- "<project id>#<number>"
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  author TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  diff_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  merged INTEGER NOT NULL,
  url TEXT NOT NULL,
  account_age_days INTEGER
);
CREATE TABLE IF NOT EXISTS classifications (
  pr_id TEXT PRIMARY KEY REFERENCES prs(id) ON DELETE CASCADE,
  label TEXT NOT NULL,                  -- 'spam' | 'genuine' | 'unclassified'
  reason TEXT NOT NULL,
  ai INTEGER NOT NULL,
  classified_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS github_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prs_project ON prs(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_prs_author ON prs(project_id, author);
"""


def db_path_from_env() -> Path:
    return Path(os.environ.get("SNIFFER_DB", str(DEFAULT_DB)))


def _project(row: dict) -> dict:
    return {**row, "maintainers": json.loads(row["maintainers"])}


class Database:
    """A fresh connection per operation keeps background threads safe."""

    def __init__(self, path: str | Path | None = None):
        self.path = Path(path) if path else db_path_from_env()
        self._write_lock = threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._retire_old_schema()
        with self.connect() as con:
            con.executescript(SCHEMA)
            cols = {r["name"] for r in con.execute("PRAGMA table_info(projects)")}
            if "source" not in cols:  # databases created before projects recorded their source
                con.execute("ALTER TABLE projects ADD COLUMN source TEXT NOT NULL DEFAULT ''")

    def _retire_old_schema(self) -> None:
        """A database from the earlier synthetic design has an incompatible `projects` table. Move it aside
        (nothing is deleted) so the current schema can be created."""
        if not self.path.exists():
            return
        con = sqlite3.connect(self.path)
        try:
            cols = {r[1] for r in con.execute("PRAGMA table_info(projects)")}
        finally:
            con.close()
        if cols and "github" not in cols:
            stamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
            self.path.rename(self.path.with_name(f"{self.path.name}.old-{stamp}"))

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        con = sqlite3.connect(self.path, timeout=10)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys = ON")
        con.execute("PRAGMA journal_mode=WAL")
        try:
            yield con
            con.commit()
        finally:
            con.close()

    def one(self, sql: str, params: tuple = ()) -> dict | None:
        with self.connect() as con:
            row = con.execute(sql, params).fetchone()
            return dict(row) if row else None

    def all(self, sql: str, params: tuple = ()) -> list[dict]:
        with self.connect() as con:
            return [dict(r) for r in con.execute(sql, params)]

    def run(self, sql: str, params: tuple = ()) -> None:
        with self._write_lock, self.connect() as con:
            con.execute(sql, params)

    # ---------- projects ----------
    def project(self, project_id: str) -> dict | None:
        row = self.one("SELECT * FROM projects WHERE id = ?", (project_id,))
        return _project(row) if row else None

    def projects_for(self, login: str) -> list[dict]:
        rows = self.all("SELECT * FROM projects ORDER BY name")
        return [_project(r) for r in rows if login.lower() in [m.lower() for m in json.loads(r["maintainers"])]]

    def unique_project_id(self, base: str) -> str:
        """`base` if free, otherwise base-2, base-3, ... Every upload is a new project."""
        candidate, n = base, 2
        while self.project(candidate) is not None:
            candidate = f"{base}-{n}"
            n += 1
        return candidate

    def save_project(
        self, project: dict, prs: list[dict], uploaded_by: str, source: str = "", replace: bool = False
    ) -> None:
        """Store a project and its PRs. `replace` overwrites a project with the same id (operator use only)."""
        with self._write_lock, self.connect() as con:
            if replace:
                con.execute("DELETE FROM projects WHERE id = ?", (project["id"],))
            con.execute(
                "INSERT INTO projects (id, name, github, maintainers, uploaded_by, source) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    project["id"],
                    project["name"],
                    project["github"],
                    json.dumps(project["maintainers"]),
                    uploaded_by,
                    source,
                ),
            )
            con.executemany(
                "INSERT INTO prs (id, project_id, number, author, title, body, diff_text, created_at, merged, url, "
                "account_age_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        f"{project['id']}#{p['number']}",
                        project["id"],
                        p["number"],
                        p["author"],
                        p["title"],
                        p["body"],
                        p["diff_text"],
                        p["created_at"],
                        int(p["merged"]),
                        p["url"],
                        p.get("account_age_days"),
                    )
                    for p in prs
                ],
            )

    def set_decision(self, project_id: str, handle: str, action: str | None, set_by: str) -> None:
        if action is None:
            self.run("DELETE FROM decisions WHERE project_id = ? AND handle = ?", (project_id, handle.lower()))
        else:
            self.run(
                "INSERT OR REPLACE INTO decisions (project_id, handle, action, set_by) VALUES (?, ?, ?, ?)",
                (project_id, handle.lower(), action, set_by),
            )

    def decisions(self, project_id: str) -> dict[str, str]:
        return {
            r["handle"]: r["action"]
            for r in self.all("SELECT handle, action FROM decisions WHERE project_id = ?", (project_id,))
        }

    def prs(self, project_id: str) -> list[dict]:
        return self.all(
            "SELECT p.*, c.label, c.reason, c.ai FROM prs p LEFT JOIN classifications c ON c.pr_id = p.id "
            "WHERE p.project_id = ? ORDER BY p.created_at, p.number",
            (project_id,),
        )

    def contributor_prs(self, project_id: str, author: str) -> list[dict]:
        return self.all(
            "SELECT p.*, c.label, c.reason, c.ai FROM prs p LEFT JOIN classifications c ON c.pr_id = p.id "
            "WHERE p.project_id = ? AND lower(p.author) = lower(?) ORDER BY p.created_at, p.number",
            (project_id, author),
        )

    def pending(self, project_id: str) -> list[dict]:
        return self.all(
            "SELECT p.* FROM prs p LEFT JOIN classifications c ON c.pr_id = p.id "
            "WHERE p.project_id = ? AND (c.pr_id IS NULL OR c.label = 'unclassified') ORDER BY p.created_at",
            (project_id,),
        )

    def save_classification(self, pr_id: str, label: str, reason: str, ai: bool) -> None:
        self.run(
            "INSERT OR REPLACE INTO classifications (pr_id, label, reason, ai) VALUES (?, ?, ?, ?)",
            (pr_id, label, reason, int(ai)),
        )

    # ---------- accounts and sessions ----------
    def user(self, login: str) -> dict | None:
        return self.one("SELECT * FROM users WHERE lower(login) = lower(?)", (login,))

    def create_user(self, login: str, salt: str, pw_hash: str) -> None:
        self.run("INSERT INTO users (login, salt, pw_hash) VALUES (?, ?, ?)", (login, salt, pw_hash))

    def add_session(self, token: str, login: str, expires_at: int) -> None:
        self.run("INSERT INTO sessions (token, login, expires_at) VALUES (?, ?, ?)", (token, login, expires_at))

    def session(self, token: str) -> dict | None:
        return self.one("SELECT * FROM sessions WHERE token = ?", (token,))

    def end_session(self, token: str) -> None:
        self.run("DELETE FROM sessions WHERE token = ?", (token,))

    # ---------- caches ----------
    def gh_get(self, key: str) -> dict | None:
        row = self.one("SELECT value, fetched_at FROM github_cache WHERE key = ?", (key,))
        return {"value": json.loads(row["value"]), "fetched_at": row["fetched_at"]} if row else None

    def gh_put(self, key: str, value: dict, fetched_at: int) -> None:
        self.run(
            "INSERT OR REPLACE INTO github_cache (key, value, fetched_at) VALUES (?, ?, ?)",
            (key, json.dumps(value), fetched_at),
        )

    def cache_get(self, key: str) -> str | None:
        row = self.one("SELECT value FROM llm_cache WHERE key = ?", (key,))
        return row["value"] if row else None

    def cache_put(self, key: str, value: str) -> None:
        self.run("INSERT OR REPLACE INTO llm_cache (key, value) VALUES (?, ?)", (key, value))
