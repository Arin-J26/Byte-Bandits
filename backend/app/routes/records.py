"""Signed records (append-only) and the evaluation endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..crypto import verify_record
from ..db import Database
from ..llm import LLM, within_budget
from ..models import EvaluateIn, Evaluation, RecordIn, RecordOut
from ..trust import evaluate as run_evaluation
from .common import ai_budget, db, llm, require_project, trust_config

router = APIRouter(prefix="/api", tags=["records"])


def public(rec: dict) -> dict:
    return {k: rec[k] for k in RecordOut.model_fields}


@router.get("/records", response_model=list[RecordOut])
def list_records(database: Database = Depends(db)):
    return [public(r) for r in database.records()]


@router.post("/records", response_model=RecordOut, status_code=201)
def add_record(body: RecordIn, database: Database = Depends(db)):
    """Append a signed record. Rejects unknown issuers, duplicate ids and bad signatures.
    There is deliberately no update or delete endpoint."""
    issuer = require_project(database, body.issuer)
    rec = body.model_dump()
    if database.record_exists(rec["id"]):
        raise HTTPException(status_code=409, detail=f"Record '{rec['id']}' already exists; records are append-only")
    if not verify_record(rec, issuer["public_key"]):
        raise HTTPException(status_code=400, detail="Signature does not verify for this issuer")
    database.insert_record(rec, signature_valid=True)
    return public({**rec, "signature_valid": True})


@router.post("/evaluate", response_model=Evaluation)
def evaluate(body: EvaluateIn, database: Database = Depends(db), model: LLM = Depends(llm)):
    project = require_project(database, body.project_id)
    result = run_evaluation(
        database.edges(), database.records(), body.project_id, body.handle, trust_config(project["max_depth"])
    )
    summary, ai = within_budget(
        lambda: model.summarize_decision(result, body.handle, body.project_id), ai_budget(), (result["summary"], False)
    )
    return {**result, "summary": summary, "ai": ai}
