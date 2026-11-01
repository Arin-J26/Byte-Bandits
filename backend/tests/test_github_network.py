"""The real GitHub test network: real repositories and PRs, synthetic trust and records.

Skipped when examples/input/github-real.json is missing (run scripts/fetch_github.py to create it).
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.routes.network import GITHUB_NETWORK

pytestmark = pytest.mark.skipif(not GITHUB_NETWORK.is_file(), reason="run scripts/fetch_github.py first")


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    app = create_app(db_path=tmp_path_factory.mktemp("gh") / "gh.db", seed_demo=False)
    c = TestClient(app)
    assert c.post("/api/simulate/load", json={"preset": "github"}).status_code == 200
    return c


def test_loads_the_ten_real_repositories(client):
    projects = client.get("/api/projects").json()
    assert len(projects) == 10
    assert {p["name"] for p in projects} >= {"oppia/oppia", "zulip/zulip", "scummvm/scummvm"}
    events = client.get("/api/events").json()
    assert sum(1 for e in events if e["kind"] == "pr") == 100  # newest 100 of the 299 in the file


def test_real_pr_authors_are_unknown_not_blocked(client):
    handles = {e["handle"] for e in client.get("/api/events").json() if e["kind"] == "pr"}
    handle = next(h for h in handles if not h.endswith("[bot]"))
    body = client.post("/api/evaluate", json={"project_id": "oppia-oppia", "handle": handle}).json()
    assert body["decision"] == "UNKNOWN"
    assert "not blocked" in body["summary"]


def test_demo_records_give_the_expected_decisions(client):
    expect = {"demo-vouched-contributor": "ALLOW", "demo-flagged-account": "FLAG", "demo-lone-denounce": "REVIEW"}
    for handle, decision in expect.items():
        body = client.post("/api/evaluate", json={"project_id": "oppia-oppia", "handle": handle}).json()
        assert body["decision"] == decision, handle


def test_no_campaign_in_real_pull_requests(client):
    # Real Dependabot bumps look alike but come from one project and old accounts: correctly not a campaign.
    assert client.get("/api/campaigns").json() == []


def _keys(obj):
    """Every dictionary key anywhere in the JSON (values such as PR diffs are not keys)."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from _keys(v)
    elif isinstance(obj, list):
        for item in obj:
            yield from _keys(item)


def test_privacy_rules_for_the_file():
    net = json.loads(Path(GITHUB_NETWORK).read_text())
    assert "private_key" not in set(_keys(net))  # text in real PR diffs is not a key
    assert all(r["subject_handle"].startswith("demo-") for r in net["records"])
    assert all(r["evidence_urls"][0].startswith("https://example.com/") for r in net["records"])
    assert "SYNTHETIC" in net["_notice"] and "REAL" in net["_notice"]
