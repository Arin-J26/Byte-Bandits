"""Campaigns (deterministic clusters + optional Gemma verdict) and the event feed."""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..campaigns import detect, suggest_denounces
from ..db import Database
from ..llm import LLM, UNCLEAR, campaign_template, cluster_sample, within_budget
from .common import ai_budget, db, llm, require_project

router = APIRouter(prefix="/api", tags=["campaigns"])


def campaigns_with_ai(database: Database, model: LLM) -> list[dict]:
    events = database.pr_events()
    by_id = {e["id"]: e for e in events}
    deadline = time.monotonic() + ai_budget()
    out = []
    for c in detect(events):

        def work(c=c):
            verdict, ai_v = model.classify_cluster(c, cluster_sample(c, by_id))
            summary, ai_s = model.summarize_campaign(c)
            return verdict, ai_v, summary, ai_s

        fallback = (UNCLEAR, False, campaign_template(c), False)
        verdict, ai_v, summary, ai_s = within_budget(work, deadline - time.monotonic(), fallback)
        out.append(
            {
                **c,
                "evidence_summary": summary,
                "ai_verdict": verdict.verdict,
                "ai_reason": verdict.reason,
                "ai": ai_v and ai_s,
            }
        )
    return out


@router.get("/campaigns")
def list_campaigns(database: Database = Depends(db), model: LLM = Depends(llm)):
    return campaigns_with_ai(database, model)


class SuggestIn(BaseModel):
    issuer: str | None = Field(default=None, max_length=100)


@router.post("/campaigns/{campaign_id}/suggest-denounce")
def suggest(campaign_id: str, body: SuggestIn | None = None, database: Database = Depends(db)):
    """Proposed, unsigned denounce records. Nothing is stored, signed or sent."""
    cluster = next((c for c in detect(database.pr_events()) if c["id"] == campaign_id), None)
    if not cluster:
        raise HTTPException(status_code=404, detail=f"Unknown campaign '{campaign_id}'")
    projects = database.projects()
    issuer = (body.issuer if body and body.issuer else None) or (
        "lumen-ui" if any(p["id"] == "lumen-ui" for p in projects) else projects[0]["id"]
    )
    require_project(database, issuer)
    return {
        "campaign_id": campaign_id,
        "issuer": issuer,
        "sent": False,
        "note": "Proposals only. Review them, then sign and publish from your own project if you agree.",
        "proposals": suggest_denounces(cluster, issuer),
    }


@router.get("/events")
def events(database: Database = Depends(db), limit: int = Query(100, ge=1, le=1000)):
    """Recent PR and record events, newest first (frontend events.json shape)."""
    feed = [
        {
            "id": e["id"],
            "kind": "pr",
            "handle": e["handle"],
            "project": e["project_id"],
            "title": e["title"],
            "timestamp": e["created_at"],
            "signature_valid": True,
        }
        for e in database.pr_events()
    ]
    feed += [
        {
            "id": f"ev-{r['id']}",
            "kind": r["type"],
            "handle": r["subject_handle"],
            "project": r["issuer"],
            "title": r["reason"],
            "record_id": r["id"],
            "timestamp": r["timestamp"],
            "signature_valid": r["signature_valid"],
        }
        for r in database.records()
    ]
    feed.sort(key=lambda x: (x["timestamp"], x["id"]), reverse=True)
    return feed[:limit]
