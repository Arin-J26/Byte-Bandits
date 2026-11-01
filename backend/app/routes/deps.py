"""Shared FastAPI dependencies: database, the signed-in maintainer, and project access."""

from __future__ import annotations

from fastapi import HTTPException, Request

from ..auth import current_login
from ..db import Database


def database(request: Request) -> Database:
    return request.app.state.db


def llm(request: Request):
    return request.app.state.llm


def signed_in(request: Request) -> str:
    login = current_login(request.app.state.db, request.cookies.get("sniffer_session"))
    if not login:
        raise HTTPException(status_code=401, detail="Sign in to continue")
    return login


def project_access(project_id: str, request: Request) -> tuple[dict, str, list[dict]]:
    """(project, login, all of this maintainer's projects). Unlocks project features only for its maintainers."""
    db: Database = request.app.state.db
    login = signed_in(request)
    project = db.project(project_id)
    mine = db.projects_for(login)
    if not project or project["id"] not in [p["id"] for p in mine]:
        raise HTTPException(status_code=404, detail="Project not found for this maintainer")
    return project, login, mine
