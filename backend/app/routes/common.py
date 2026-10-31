"""Shared helpers for routes."""

from __future__ import annotations

import os

from fastapi import HTTPException, Request

from ..db import Database
from ..llm import LLM
from ..trust import TrustConfig


def db(request: Request) -> Database:
    return request.app.state.db


def llm(request: Request) -> LLM:
    return request.app.state.llm


def ai_budget() -> float:
    """Seconds a request may wait for Gemma before answering with deterministic text.
    The model keeps working in the background and caches its answer for the next request."""
    return float(os.environ.get("SNIFFER_AI_BUDGET", "6"))


def default_decay() -> float:
    return float(os.environ.get("SNIFFER_DECAY", "0.8"))


def trust_config(max_depth: int | None = None, decay: float | None = None) -> TrustConfig:
    env = os.environ.get
    return TrustConfig(
        decay=float(decay) if decay is not None else default_decay(),
        max_depth=int(max_depth or env("SNIFFER_MAX_DEPTH", "3")),
        allow_threshold=float(env("SNIFFER_ALLOW_THRESHOLD", "0.5")),
        flag_threshold=float(env("SNIFFER_FLAG_THRESHOLD", "-0.5")),
        min_denouncers=int(env("SNIFFER_MIN_DENOUNCERS", "2")),
        half_life_days=float(env("SNIFFER_HALF_LIFE_DAYS", "180")),
    )


def require_project(database: Database, project_id: str) -> dict:
    p = database.project(project_id)
    if not p:
        raise HTTPException(status_code=404, detail=f"Unknown project '{project_id}'")
    return p
