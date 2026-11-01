"""Every endpoint returns the shape of its frontend fixture (frontend/mock/*.json)."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.crypto import sign_record
from app.llm import LLM
from app.main import create_app

MOCK = Path(__file__).resolve().parents[2] / "frontend" / "mock"


def fixture(name):
    return json.loads((MOCK / name).read_text())


def same_shape(expected: dict, actual: dict, where: str):
    """Every fixture key exists with a compatible JSON type (extra backend keys are allowed)."""

    def kind(v):
        return "number" if isinstance(v, (int, float)) and not isinstance(v, bool) else type(v).__name__

    for k, v in expected.items():
        assert k in actual, f"{where}: missing key {k!r}"
        assert kind(actual[k]) == kind(v), f"{where}.{k}: {kind(actual[k])} != {kind(v)}"


@pytest.fixture()
def client(tmp_path):
    app = create_app(db_path=tmp_path / "api.db", llm=LLM(host="http://127.0.0.1:9"))
    return TestClient(app)


def test_health(client):
    body = client.get("/api/health").json()
    assert body == {"status": "ok", "model": "gemma4:e2b", "ollama_available": False, "ollama_running": False}


def test_projects_and_edges_match_fixtures(client):
    projects = client.get("/api/projects").json()
    assert 20 <= len(projects) <= 50
    same_shape(fixture("projects.json")[0], projects[0], "projects")
    assert set(projects[0]) == {"id", "name"}  # no keys of any kind leak
    edges = client.get("/api/trust-edges").json()
    same_shape(fixture("trust-edges.json")[0], edges[0], "trust-edges")


def test_records_match_fixture_and_hide_signatures(client):
    recs = client.get("/api/records").json()
    assert set(recs[0]) == set(fixture("records.json")[0])
    for r in recs:
        same_shape(fixture("records.json")[0], r, "records")
    assert sum(1 for r in recs if not r["signature_valid"]) == 1


@pytest.mark.parametrize(
    "name,handle,decision",
    [
        ("evaluate-allow.json", "ada-commits", "ALLOW"),
        ("evaluate-unknown.json", "newbie-nora", "UNKNOWN"),
        ("evaluate-flag.json", "spam-bot-7731", "FLAG"),
    ],
)
def test_evaluate_matches_fixtures(client, name, handle, decision):
    fx = fixture(name)
    body = client.post("/api/evaluate", json={"project_id": "lumen-ui", "handle": handle}).json()
    assert body["decision"] == decision == fx["decision"]
    for k in ("decision", "score", "summary", "path", "ignored"):
        assert k in body
    assert body["ai"] is False
    if fx["path"]:
        same_shape(fx["path"][0], body["path"][0], "path")
    if fx["ignored"] and body["ignored"]:  # contents differ between mock data and the simulation
        same_shape(fx["ignored"][0], body["ignored"][0], "ignored")


def test_lone_denounce_is_review(client):
    body = client.post("/api/evaluate", json={"project_id": "lumen-ui", "handle": "solo-denounce-sam"}).json()
    assert body["decision"] == "REVIEW"


def test_trust_update_changes_decision(client):
    ev = lambda: client.post("/api/evaluate", json={"project_id": "lumen-ui", "handle": "borderline-ben"}).json()  # noqa: E731
    assert ev()["decision"] == "ALLOW"
    r = client.put("/api/trust", json={"project_id": "lumen-ui", "peer_id": "pyforge", "weight": 0.5})
    assert r.status_code == 200 and r.json()["ok"] is True
    assert ev()["decision"] == "REVIEW"
    assert (
        client.put("/api/trust", json={"project_id": "lumen-ui", "peer_id": "nope", "weight": 0.5}).status_code == 404
    )
    assert (
        client.put("/api/trust", json={"project_id": "lumen-ui", "peer_id": "pyforge", "weight": 2}).status_code == 422
    )


def test_campaigns_match_fixture(client):
    camps = client.get("/api/campaigns").json()
    assert len(camps) == 1
    fx = fixture("campaigns.json")[0]
    same_shape({k: v for k, v in fx.items() if k != "pr_events"}, camps[0], "campaign")
    same_shape(fx["pr_events"][0], camps[0]["pr_events"][0], "pr_event")
    assert camps[0]["ai_verdict"] == "unclear" and "ai_reason" in camps[0]
    assert len(camps[0]["pr_events"]) == 38


def test_suggest_denounce_sends_nothing(client):
    cid = client.get("/api/campaigns").json()[0]["id"]
    before = len(client.get("/api/records").json())
    body = client.post(f"/api/campaigns/{cid}/suggest-denounce", json={"issuer": "pyforge"}).json()
    assert body["sent"] is False and body["issuer"] == "pyforge" and body["proposals"]
    assert len(client.get("/api/records").json()) == before
    assert client.post("/api/campaigns/camp-nope/suggest-denounce").status_code == 404


def test_events_match_fixture_newest_first(client):
    events = client.get("/api/events").json()
    common = {"id", "kind", "handle", "project", "title", "timestamp", "signature_valid"}
    fx = fixture("events.json")[0]
    for e in events:
        same_shape({k: fx[k] for k in common}, e, "event")
    stamps = [e["timestamp"] for e in events]
    assert stamps == sorted(stamps, reverse=True)
    assert {e["kind"] for e in events} >= {"pr", "vouch", "denounce"}


def _signed(app_client, issuer="nebula-db", **kw):
    rec = {
        "id": "rec-new-1",
        "issuer": issuer,
        "subject_handle": "newbie-nora",
        "type": "vouch",
        "reason": "First PR merged with tests",
        "evidence_urls": ["https://example.com/x"],
        "timestamp": "2026-11-01T09:00:00Z",
        **kw,
    }
    priv = app_client.app.state.db.private_key(issuer)
    rec["signature"] = sign_record(rec, priv)
    return rec


def test_post_record_verifies_and_appends(client):
    rec = _signed(client)
    r = client.post("/api/records", json=rec)
    assert r.status_code == 201 and r.json()["signature_valid"] is True and "signature" not in r.json()
    assert client.post("/api/records", json=rec).status_code == 409  # append-only, no overwrite
    body = client.post("/api/evaluate", json={"project_id": "lumen-ui", "handle": "newbie-nora"}).json()
    assert body["decision"] == "ALLOW"


def test_post_record_rejects_bad_signature_and_missing_evidence(client):
    rec = _signed(client, id="rec-new-2")
    rec["reason"] = "tampered"
    assert client.post("/api/records", json=rec).status_code == 400
    no_ev = _signed(client, id="rec-new-3", type="denounce", evidence_urls=[])
    r = client.post("/api/records", json=no_ev)
    assert r.status_code == 422 and "evidence" in json.dumps(r.json())
    assert client.post("/api/records", json=_signed(client, id="rec-new-4") | {"issuer": "ghost"}).status_code == 404
    assert client.delete("/api/records").status_code in (404, 405)


def test_simulate_accepts_frontend_and_snake_case_params(client):
    a = client.post(
        "/api/simulate/load", json={"projectCount": 25, "newcomers": 3, "campaignSize": 12, "seed": 5}
    ).json()
    assert a["projects"] == 25
    b = client.post("/api/simulate/load", json={"projects": 30, "campaign_size": 20, "seed": 5}).json()
    assert b["projects"] == 30
    assert client.post("/api/simulate/load", json={"preset": "demo"}).json()["projects"] == 40
    assert client.post("/api/simulate/load", json={"projects": 99}).status_code == 422


def test_export_import_roundtrip_without_private_keys(client):
    exported = client.get("/api/network/export").json()
    assert "private_key" not in json.dumps(exported)
    client.post("/api/simulate/load", json={"projects": 20, "seed": 9})
    r = client.post("/api/network/import", json=exported)
    assert r.status_code == 200 and r.json()["invalid_signatures"] == 1
    assert client.get("/api/network/export").json()["records"] == exported["records"]


def test_import_rejects_bad_input(client):
    assert client.post("/api/network/import", content=b"{nope").status_code == 422
    assert client.post("/api/network/import", json={"projects": []}).status_code == 422
    big = b'{"projects": [], "pad": "' + b"x" * (5 * 1024 * 1024) + b'"}'
    assert client.post("/api/network/import", content=big).status_code == 413
    exported = client.get("/api/network/export").json()
    exported["trust_edges"].append({"from": "lumen-ui", "to": "ghost", "weight": 1})
    assert client.post("/api/network/import", json=exported).status_code == 422


def test_errors_are_json(client):
    r = client.get("/api/nope")
    assert r.status_code == 404 and "error" in r.json()
    r = client.post("/api/evaluate", json={"project_id": "lumen-ui"})
    assert r.status_code == 422 and r.json()["error"] == "Invalid request"


def test_root_serves_frontend(client):
    r = client.get("/")
    assert r.status_code == 200
    assert (MOCK.parent / "index.html").read_text() == r.text
    assert client.get("/js/api.js").status_code == 200


def test_trust_settings_roundtrip_and_effect(client):
    s = client.get("/api/trust/settings", params={"project_id": "lumen-ui"}).json()
    assert s == {"project_id": "lumen-ui", "max_depth": 3, "decay": 0.8}
    ev = lambda: client.post("/api/evaluate", json={"project_id": "lumen-ui", "handle": "ada-commits"}).json()  # noqa: E731
    assert ev()["path"][0]["weight"] == 0.8
    r = client.put("/api/trust/settings", json={"project_id": "lumen-ui", "max_depth": 1, "decay": 0.9})
    assert r.status_code == 200
    body = ev()
    assert body["path"][0]["weight"] == 0.9 and len(body["path"]) == 1  # quasar-cli is now beyond depth 1
    assert any("beyond depth limit (1 hops)" == i["reason"] for i in body["ignored"])
    assert (
        client.put("/api/trust/settings", json={"project_id": "lumen-ui", "max_depth": 9, "decay": 0.9}).status_code
        == 422
    )
    assert client.get("/api/trust/settings", params={"project_id": "nope"}).status_code == 404


def test_import_rejects_duplicate_ids_with_422_not_500(client):
    exported = client.get("/api/network/export").json()
    dup = dict(exported, projects=exported["projects"] + [exported["projects"][0]])
    r = client.post("/api/network/import", json=dup)
    assert r.status_code == 422 and "unique" in json.dumps(r.json())
    dup_ev = dict(exported, pr_events=exported["pr_events"] + [exported["pr_events"][0]])
    assert client.post("/api/network/import", json=dup_ev).status_code == 422


def test_frontend_is_never_served_stale(client):
    assert client.get("/js/api.js").headers["cache-control"] == "no-cache"
    assert "cache-control" not in client.get("/api/health").headers
