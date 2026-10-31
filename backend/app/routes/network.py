"""Projects, trust edges, simulation, network export/import."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import ValidationError

from ..crypto import RecordRuleError, check_record_rules, verify_record
from ..db import Database
from ..models import NetworkIn, Project, SimulateIn, TrustEdge, TrustSettings, TrustUpdate
from ..simulate import generate_network
from .common import db, default_decay, require_project

router = APIRouter(prefix="/api", tags=["network"])
MAX_IMPORT_BYTES = 5 * 1024 * 1024


@router.get("/projects", response_model=list[Project])
def list_projects(database: Database = Depends(db)):
    return [{"id": p["id"], "name": p["name"]} for p in database.projects()]


@router.get("/trust-edges", response_model=list[TrustEdge], response_model_by_alias=True)
def list_edges(database: Database = Depends(db)):
    return database.edges()


@router.put("/trust")
def put_trust(body: TrustUpdate, database: Database = Depends(db)):
    require_project(database, body.project_id)
    require_project(database, body.peer_id)
    if body.project_id == body.peer_id:
        raise HTTPException(status_code=422, detail="A project cannot set trust in itself")
    database.upsert_edge(body.project_id, body.peer_id, body.weight)
    return {"ok": True, "project_id": body.project_id, "peer_id": body.peer_id, "weight": body.weight}


@router.get("/trust/settings", response_model=TrustSettings)
def get_settings(project_id: str, database: Database = Depends(db)):
    p = require_project(database, project_id)
    return {
        "project_id": p["id"],
        "max_depth": p["max_depth"],
        "decay": p["decay"] if p["decay"] is not None else default_decay(),
    }


@router.put("/trust/settings", response_model=TrustSettings)
def put_settings(body: TrustSettings, database: Database = Depends(db)):
    """How far (max_depth) and how fast (decay) trust travels when this project evaluates someone."""
    require_project(database, body.project_id)
    database.set_project_settings(body.project_id, body.max_depth, body.decay)
    return body


def load_simulation(database: Database, params: SimulateIn) -> dict:
    if params.preset == "demo":
        params = SimulateIn(seed=params.seed)
    net = generate_network(
        projects=params.projects, newcomers=params.newcomers, campaign_size=params.campaign_size, seed=params.seed
    )
    database.replace_network(net)
    return {
        "ok": True,
        "seed": params.seed,
        "projects": len(net["projects"]),
        "trust_edges": len(net["trust_edges"]),
        "records": len(net["records"]),
        "pr_events": len(net["pr_events"]),
        "spam_accounts": len(net["spam_handles"]),
    }


@router.post("/simulate/load")
def simulate_load(params: SimulateIn | None = None, database: Database = Depends(db)):
    return load_simulation(database, params or SimulateIn())


@router.get("/network/export")
def export_network(database: Database = Depends(db)):
    """Full network without private keys."""
    return {
        "projects": database.projects(),
        "trust_edges": database.edges(),
        "records": database.records(),
        "pr_events": database.pr_events(),
    }


@router.post("/network/import")
async def import_network(request: Request, database: Database = Depends(db)):
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail="Network file is larger than 5 MB")
    raw = await request.body()
    if len(raw) > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail="Network file is larger than 5 MB")
    try:
        net = NetworkIn.model_validate(json.loads(raw))
    except (json.JSONDecodeError, UnicodeDecodeError) as err:
        raise HTTPException(status_code=422, detail="Body is not valid JSON") from err
    except ValidationError as err:
        raise HTTPException(
            status_code=422, detail=[{"loc": e["loc"], "msg": e["msg"]} for e in err.errors()[:10]]
        ) from err

    keys = {p.id: p.public_key for p in net.projects}
    problems = []
    for i, e in enumerate(net.trust_edges):
        if e.from_ not in keys or e.to not in keys:
            problems.append(f"trust_edges[{i}] points to an unknown project")
    records = []
    for i, r in enumerate(net.records):
        rec = r.model_dump()
        if rec["issuer"] not in keys:
            problems.append(f"records[{i}] has an unknown issuer")
            continue
        try:
            check_record_rules(rec)
        except RecordRuleError as err:
            problems.append(f"records[{i}]: {err}")
            continue
        rec["signature_valid"] = verify_record(rec, keys[rec["issuer"]])  # verified on import
        records.append(rec)
    if len({p.id for p in net.projects}) != len(net.projects):
        problems.append("project ids must be unique")
    if len({e.id for e in net.pr_events}) != len(net.pr_events):
        problems.append("pr_event ids must be unique")
    if len({r.id for r in net.records}) != len(net.records):
        problems.append("record ids must be unique")
    if problems:
        raise HTTPException(status_code=422, detail=problems[:10])

    database.replace_network(
        {
            "projects": [p.model_dump() for p in net.projects],
            "trust_edges": [e.model_dump(by_alias=True) for e in net.trust_edges],
            "records": records,
            "pr_events": [e.model_dump() for e in net.pr_events],
        }
    )
    return {
        "ok": True,
        "projects": len(net.projects),
        "trust_edges": len(net.trust_edges),
        "records": len(records),
        "invalid_signatures": sum(1 for r in records if not r["signature_valid"]),
        "pr_events": len(net.pr_events),
    }
