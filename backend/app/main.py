"""FastAPI app: JSON API under /api, then the frontend served as static files (mounted last).

Run from the repo root:  backend/.venv/bin/uvicorn app.main:app --app-dir backend --port 8000
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .db import Database
from .github import GitHubError
from .llm import LLM
from .routes import auth, projects

FRONTEND_DIR = Path(os.environ.get("SNIFFER_FRONTEND", Path(__file__).resolve().parents[2] / "frontend"))


def create_app(db_path: str | Path | None = None, llm: LLM | None = None) -> FastAPI:
    app = FastAPI(title="Sniffer API", version="0.2.0", docs_url="/api/docs", openapi_url="/api/openapi.json")
    database = Database(db_path)
    app.state.db = database
    app.state.llm = llm or LLM(cache=database)

    @app.middleware("http")
    async def no_stale_frontend(request: Request, call_next):
        """Frontend files are always revalidated, so an update never mixes old and new JavaScript."""
        response = await call_next(request)
        if not request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-cache"
        return response

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})

    @app.exception_handler(GitHubError)
    async def github_error(_: Request, exc: GitHubError):
        return JSONResponse(status_code=exc.status, content={"error": str(exc)})

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        details = [{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()[:10]]
        return JSONResponse(status_code=422, content={"error": "Invalid request", "details": details})

    @app.get("/api/health")
    def health(request: Request):
        model: LLM = request.app.state.llm
        running, ready = model.status()
        return {"status": "ok", "model": model.model, "ollama_available": ready, "ollama_running": running}

    app.include_router(auth.router)
    app.include_router(projects.router)

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    def api_not_found(rest: str):
        raise HTTPException(status_code=404, detail=f"No API endpoint /api/{rest}")

    if FRONTEND_DIR.is_dir():  # mounted LAST so /api/* always wins
        app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
    return app


app = create_app()
