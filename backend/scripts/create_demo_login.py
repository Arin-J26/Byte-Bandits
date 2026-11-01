"""DEMO ONLY: create a local login that is not checked against GitHub, and list it as a maintainer of the demo project.

    backend/.venv/bin/python backend/scripts/create_demo_login.py Adi_26 123456

The regular sign-up still requires a real GitHub user. Use this only on a local test database.
"""

from __future__ import annotations

import json
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth import _hash  # noqa: E402
from app.db import Database  # noqa: E402


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: create_demo_login.py <username> <password>")
    login, password = sys.argv[1], sys.argv[2]
    db = Database()
    projects = db.all("SELECT id, maintainers FROM projects")
    if not projects:
        raise SystemExit("No project in this database yet. Load the demo project first (load_project.py).")
    if db.user(login) is None:
        salt = secrets.token_hex(16)
        db.create_user(login, salt, _hash(password, salt))
        print(f"created login {login}")
    else:
        print(f"login {login} already exists; password unchanged")
    for p in projects:
        maintainers = json.loads(p["maintainers"])
        if login.lower() not in [m.lower() for m in maintainers]:
            maintainers.append(login)
            db.run("UPDATE projects SET maintainers = ? WHERE id = ?", (json.dumps(maintainers), p["id"]))
            print(f"added {login} as maintainer of {p['id']}")


if __name__ == "__main__":
    main()
