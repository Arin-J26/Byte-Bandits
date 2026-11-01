"""Dashboard, project upload, and every project feature. Each route checks that the signed-in
maintainer is listed on the project, so nothing is reachable before a project is chosen."""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from .. import analysis, github, jobs
from ..campaigns import suggest_denounces
from ..db import Database
from ..ingest import IngestError, parse_upload
from ..llm import UNCLEAR, campaign_template, cluster_sample, github_template, within_budget
from ..models import DecisionIn, EvaluateIn
from .deps import database, llm, project_access, signed_in

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("")
def dashboard(request: Request, db: Database = Depends(database)):
    login = signed_in(request)
    mine = db.projects_for(login)
    return {"login": login, "projects": [analysis.project_stats(db, p, mine) for p in mine]}


@router.post("", status_code=201)
async def upload(request: Request, db: Database = Depends(database)):
    login = signed_in(request)
    raw = await request.body()
    try:
        return parse_upload(db, raw, login)
    except IngestError as err:
        raise HTTPException(status_code=err.status, detail=str(err)) from err


@router.get("/{project_id}")
def overview(project_id: str, request: Request, db: Database = Depends(database)):
    project, _, mine = project_access(project_id, request)
    return analysis.project_stats(db, project, mine)


@router.post("/{project_id}/classify", status_code=202)
def classify(project_id: str, request: Request, db: Database = Depends(database), model=Depends(llm)):
    project, _, _ = project_access(project_id, request)
    return jobs.start(db, model, project["id"])


@router.get("/{project_id}/classify")
def classify_status(project_id: str, request: Request):
    project, _, _ = project_access(project_id, request)
    return jobs.status(project["id"])


@router.get("/{project_id}/graph")
def graph(project_id: str, request: Request, db: Database = Depends(database)):
    project, _, _ = project_access(project_id, request)
    return {"months": analysis.graph_series(db, project), "stats": analysis.project_stats(db, project, [project])}


@router.get("/{project_id}/trust")
def trust_lists(project_id: str, request: Request, db: Database = Depends(database)):
    project, _, mine = project_access(project_id, request)
    rows = analysis.contributors(db, project, mine)
    # Each contributor is in exactly one list: any spam PR here (spam weight 1-100%) means not trusted.
    trusted = sorted((r for r in rows if not r["spam_weight"]), key=lambda r: (-r["genuine"], r["handle"].lower()))
    not_trusted = sorted((r for r in rows if r["spam_weight"]), key=lambda r: (-r["spam_weight"], r["handle"].lower()))
    return {"trusted": trusted, "not_trusted": not_trusted, "contributors": len(rows)}


@router.get("/{project_id}/contributors")
def contributors(project_id: str, request: Request, db: Database = Depends(database)):
    project, _, _ = project_access(project_id, request)
    return sorted({p["author"] for p in db.prs(project["id"])}, key=str.lower)


@router.get("/{project_id}/decisions")
def decisions(project_id: str, request: Request, db: Database = Depends(database)):
    project, _, _ = project_access(project_id, request)
    return db.decisions(project["id"])


@router.put("/{project_id}/decisions/{handle}")
def set_decision(project_id: str, handle: str, body: DecisionIn, request: Request, db: Database = Depends(database)):
    """Block or accept a contributor, or clear an earlier choice. Only the maintainer sets this."""
    project, login, _ = project_access(project_id, request)
    if not github.valid_login(handle.strip().lstrip("@")):
        raise HTTPException(status_code=422, detail="Not a valid GitHub username")
    action = None if body.action == "clear" else body.action
    db.set_decision(project["id"], handle.strip().lstrip("@"), action, login)
    return {"handle": handle.strip().lstrip("@"), "decision": action}


@router.get("/{project_id}/events")
def events(project_id: str, request: Request, db: Database = Depends(database)):
    """PRs across the maintainer's projects, newest first, for the campaign radar and ticker."""
    project, _, mine = project_access(project_id, request)
    out = []
    every = sorted((p for proj in mine for p in db.prs(proj["id"])), key=lambda x: (x["created_at"], x["id"]))
    for p in reversed(every):
        out.append(
            {
                "id": p["id"],
                "kind": "denounce" if p.get("label") == "spam" else "vouch" if p.get("label") == "genuine" else "pr",
                "handle": p["author"],
                "project": p["project_id"],
                "title": p["title"],
                "timestamp": p["created_at"],
                "url": p["url"],
                "label": p.get("label") or "pending",
            }
        )
    return out


@router.get("/{project_id}/records")
def records(
    project_id: str,
    request: Request,
    handle: str = Query(min_length=1, max_length=39),
    db: Database = Depends(database),
):
    project, _, _ = project_access(project_id, request)
    handle = handle.strip().lstrip("@")
    prs = db.contributor_prs(project["id"], handle)
    rows = []
    for i, p in enumerate(prs, start=1):
        spam = p.get("label") == "spam"
        genuine = p.get("label") == "genuine"
        rows.append(
            {
                "tag": f"PR{i}",
                "number": p["number"],
                "title": p["title"],
                "url": p["url"],
                "subject": "spam" if spam else "not spam" if genuine else "pending",
                "type": "denounced" if spam else "voucher" if genuine else "pending",
                # Only spam carries a reason, evidence and timestamp; "not spam" leaves them blank, as specified.
                "reason": p.get("reason") or "" if spam else "",
                "evidence": p["url"] if spam else "",
                "timestamp": p["created_at"] if spam else "",
                "ai": bool(p.get("ai")),
            }
        )
    return {
        "handle": handle,
        "spam_weight": analysis.spam_weight(prs),
        "decision": db.decisions(project["id"]).get(handle.lower()),
        "prs": rows,
    }


@router.post("/{project_id}/evaluate")
def evaluate(project_id: str, body: EvaluateIn, request: Request, db: Database = Depends(database), model=Depends(llm)):
    project, _, mine = project_access(project_id, request)
    handle = body.handle.strip().lstrip("@")
    result = analysis.evaluate_contributor(db, project, mine, handle)
    summary, ai = within_budget(
        lambda: model.summarize_decision(result, handle, project["id"]), _budget(), (result["summary"], False)
    )
    if result["decision"] == "UNKNOWN" and "not blocked" not in summary.lower():
        summary = f"{summary} Normal review, not blocked."  # policy guarantee, enforced here whatever the model wrote
    return {
        **result,
        "summary": summary,
        "ai": ai,
        "handle": handle,
        "spam_weight": analysis.spam_weight(db.contributor_prs(project["id"], handle)),
        "maintainer_decision": db.decisions(project["id"]).get(handle.lower()),
    }


@router.get("/{project_id}/contributors/{handle}/github")
def github_check(project_id: str, handle: str, request: Request, db: Database = Depends(database), model=Depends(llm)):
    project, _, _ = project_access(project_id, request)
    handle = handle.strip().lstrip("@")
    try:
        stats = github.contributor_stats(db, handle, exclude_repo=project["github"])
    except github.GitHubError as err:
        raise HTTPException(status_code=err.status, detail=str(err)) from err
    summary, ai = within_budget(
        lambda: model.summarize_github(handle, stats), _budget(), (github_template(stats), False)
    )
    return {**stats, "summary": summary, "ai": ai, "checked_at": int(time.time())}


@router.get("/{project_id}/campaigns")
def campaigns(
    project_id: str,
    request: Request,
    db: Database = Depends(database),
    model=Depends(llm),
    window_minutes: int = Query(240, ge=5, le=10080),
    min_size: int = Query(5, ge=2, le=200),
):
    project, _, mine = project_access(project_id, request)
    found = analysis.campaigns_for(db, project, mine, window_minutes, min_size)
    by_id = {p["id"]: p for p in db.prs(project["id"])}
    out = []
    for c in found:

        def work(c=c):
            verdict, ai_v = model.classify_cluster(c, cluster_sample(c, by_id))
            text, ai_s = model.summarize_campaign(c)
            return verdict, ai_v, text, ai_s

        fallback = (UNCLEAR, False, campaign_template(c), False)
        verdict, ai_v, summary, ai_s = within_budget(work, _budget(), fallback)
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


@router.post("/{project_id}/campaigns/{campaign_id}/suggest")
def suggest(
    project_id: str,
    campaign_id: str,
    request: Request,
    db: Database = Depends(database),
    window_minutes: int = Query(240, ge=5, le=10080),
    min_size: int = Query(5, ge=2, le=200),
):
    """Unsigned denounce proposals for a campaign. Nothing is stored, signed or sent.
    Pass the same window and minimum size the campaign list was built with."""
    project, login, mine = project_access(project_id, request)
    found = analysis.campaigns_for(db, project, mine, window_minutes, min_size)
    cluster = next((c for c in found if c["id"] == campaign_id), None)
    if not cluster:
        raise HTTPException(status_code=404, detail=f"Unknown campaign '{campaign_id}'")
    issuer = project["id"]
    return {
        "campaign_id": campaign_id,
        "issuer": issuer,
        "sent": False,
        "note": "Proposals only. Review them before any maintainer decides anything.",
        "proposals": suggest_denounces(cluster, issuer),
    }


def _budget() -> float:
    from os import environ

    return float(environ.get("SNIFFER_AI_BUDGET", "6"))
