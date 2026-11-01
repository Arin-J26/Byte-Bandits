"""The whole maintainer flow, offline: sign-up checks, upload rules, project gating, classification,
records, evaluation, trust lists, campaigns and the GitHub check. Gemma and GitHub are replaced by fakes."""

import io
import json
import time
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.github import GitHubError
from app.ingest import parse_upload
from app.llm import LLM
from app.main import create_app
from app.models import ClusterVerdict, PrVerdict

SPAM_DIFF = "--- a/README.md\n+++ b/README.md\n-Teh quick fox\n+The quick fox\n"


class FakeLLM(LLM):
    """Answers like Gemma would for these fixtures: spam-bot's PRs are spam, everyone else's are genuine."""

    def __init__(self):
        super().__init__(host="http://127.0.0.1:9")

    def status(self):
        return True, True

    def available(self):
        return True

    def classify_pr(self, pr):
        spam = pr["author"] == "spam-bot"
        return PrVerdict(spam=spam, reason="near-identical typo PR from a new account" if spam else ""), True

    def summarize_decision(self, evaluation, handle, project_id):
        return f"{evaluation['decision']}: fake summary for {handle}", True

    def summarize_github(self, login, stats):
        return f"{login} has merged PRs in {stats['repos_with_merged_prs']} other repositories.", True

    def classify_cluster(self, cluster, sample):
        return ClusterVerdict(verdict="spam", reason="same text, new accounts"), True

    def summarize_campaign(self, cluster):
        return "fake campaign summary", True


def pr(number, author, title, created, merged=True, age=3, diff=SPAM_DIFF):
    return {
        "number": number,
        "author": author,
        "title": title,
        "body": "small fix",
        "created_at": created,
        "merged": merged,
        "url": f"https://github.com/example/d1-repo/pull/{number}",
        "diff": diff,
        "account_age_days": age,
    }


PRS_D1 = [
    pr(1, "spam-bot", "Fix typo in README.md", "2026-10-01T10:00:00Z"),
    pr(2, "spam-bot", "Fix typo in README.md", "2026-10-01T10:05:00Z"),
    pr(3, "spam-bot", "Fixed a typo in README", "2026-10-01T10:09:00Z"),
    pr(
        4,
        "ada",
        "Add dark mode to settings",
        "2026-09-20T09:00:00Z",
        age=900,
        diff="--- a/src/a.py\n+++ b/src/a.py\n+def theme(): pass\n",
    ),
    pr(
        5,
        "ada",
        "Fix off-by-one in pagination",
        "2026-09-25T09:00:00Z",
        age=900,
        diff="--- a/src/b.py\n+++ b/src/b.py\n+def page(n): return n-1\n",
    ),
]


def zip_bytes(project, prs=None):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("d1/project.json", json.dumps(project))
        if prs is not None:
            zf.writestr("d1/prs.json", json.dumps(prs))
    return buf.getvalue()


D1 = {"id": "d1", "name": "D1", "github": "example/d1-repo", "maintainers": ["Arin-J26"]}
D2 = {"id": "d2", "name": "D2", "github": "example/d2-repo", "maintainers": ["Arin-J26", "Other-Dev"]}
PASSWORD = "correct horse battery"


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "app.auth.github_user",
        lambda db, login: (
            {"login": login, "created_at": "2015-01-01T00:00:00Z", "public_repos": 3}
            if login != "ghost-user"
            else (_ for _ in ()).throw(GitHubError("Not found on GitHub", 404))
        ),
    )
    monkeypatch.setattr(
        "app.github.contributor_stats",
        lambda db, login, exclude_repo=None: {
            "login": login,
            "account_created": "2015-01-01T00:00:00Z",
            "account_age_days": 3650,
            "public_repos": 3,
            "merged_prs_found": 7,
            "repos_with_merged_prs": 4,
            "top_repos": ["x/y"],
            "search_capped": False,
            "cached": False,
        },
    )
    app = create_app(db_path=tmp_path / "flow.db", llm=FakeLLM())
    parse_upload(app.state.db, zip_bytes(D2, []), "Arin-J26")  # operator loads the first project
    parse_upload(app.state.db, zip_bytes(D1, PRS_D1), "Arin-J26")
    return TestClient(app), app


def sign_up(client, login, password=PASSWORD):
    return client.post("/api/auth/signup", json={"login": login, "password": password})


def wait_done(client, pid):
    for _ in range(200):
        s = client.get(f"/api/projects/{pid}/classify").json()
        if s["state"] in ("done", "failed"):
            return s
        time.sleep(0.02)
    raise AssertionError("classification did not finish")


def test_sign_up_requires_a_real_github_user_and_a_listed_project(env):
    client, _ = env
    assert sign_up(client, "ghost-user").status_code == 404
    assert sign_up(client, "Stranger").status_code == 403
    assert sign_up(client, "Arin-J26", "short").status_code == 422
    r = sign_up(client, "Arin-J26")
    assert r.status_code == 200 and r.json()["login"] == "Arin-J26"
    assert "sniffer_session" in r.cookies
    assert sign_up(client, "Arin-J26").status_code == 409


def test_sign_in_and_sign_out(env):
    client, _ = env
    sign_up(client, "Arin-J26")
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"login": "Arin-J26", "password": "wrong password 1"}).status_code == 401
    assert client.post("/api/auth/login", json={"login": "Arin-J26", "password": PASSWORD}).status_code == 200
    assert client.get("/api/auth/me").json() == {"login": "Arin-J26"}


def test_dashboard_lists_only_my_projects(env):
    client, _ = env
    sign_up(client, "Arin-J26")
    rows = client.get("/api/projects").json()["projects"]
    assert {r["id"] for r in rows} == {"d1", "d2"}
    d1 = next(r for r in rows if r["id"] == "d1")
    assert d1["prs_total"] == 5 and d1["merged_prs"] == 5 and d1["unclassified"] == 5
    client.post("/api/auth/logout")
    sign_up(client, "Other-Dev")
    assert [r["id"] for r in client.get("/api/projects").json()["projects"]] == ["d2"]


def test_project_features_are_locked_to_its_maintainers(env):
    client, _ = env
    sign_up(client, "Other-Dev")
    assert client.get("/api/projects/d1").status_code == 404  # not one of D1's maintainers
    assert client.get("/api/projects/d1/records?handle=ada").status_code == 404
    assert client.get("/api/projects/d2").status_code == 200
    client.post("/api/auth/logout")
    assert client.get("/api/projects/d2").status_code == 401  # signed out


def test_classification_then_records_show_spam_or_not_spam(env):
    client, _ = env
    sign_up(client, "Arin-J26")
    assert client.post("/api/projects/d1/classify").status_code == 202
    assert wait_done(client, "d1")["done"] == 5
    rows = client.get("/api/projects/d1/records?handle=spam-bot").json()["prs"]
    assert [r["tag"] for r in rows] == ["PR1", "PR2", "PR3"]
    assert all(r["subject"] == "spam" and r["type"] == "denounced" and r["evidence"] for r in rows)
    assert all(r["reason"] and r["timestamp"] for r in rows)
    ada = client.get("/api/projects/d1/records?handle=ada").json()["prs"]
    assert all(r["subject"] == "not spam" and r["type"] == "voucher" for r in ada)
    assert all(r["reason"] == "" and r["evidence"] == "" and r["timestamp"] == "" for r in ada)


def test_evaluate_uses_real_classifications_and_one_project_cannot_flag(env):
    client, _ = env
    sign_up(client, "Arin-J26")
    client.post("/api/projects/d1/classify")
    wait_done(client, "d1")
    spam = client.post("/api/projects/d1/evaluate", json={"handle": "spam-bot"}).json()
    assert spam["decision"] == "REVIEW"  # one project's denounce is a soft signal
    assert spam["summary"].startswith("REVIEW")
    ada = client.post("/api/projects/d1/evaluate", json={"handle": "ada"}).json()
    assert ada["decision"] == "ALLOW"
    nobody = client.post("/api/projects/d1/evaluate", json={"handle": "nobody-here"}).json()
    assert nobody["decision"] == "UNKNOWN" and "not blocked" in nobody["summary"]


def test_flag_needs_two_maintainer_projects_that_both_see_spam(env):
    client, app = env
    sign_up(client, "Arin-J26")
    client.post("/api/projects/d1/classify")
    wait_done(client, "d1")
    # Give D2 the same spam history, so two independent projects denounce the account.
    second = parse_upload(
        app.state.db,
        zip_bytes(dict(D2), [dict(p, url=p["url"].replace("d1-repo", "d2-repo")) for p in PRS_D1[:3]]),
        "Arin-J26",
    )
    assert second["id"] == "d2-2"  # every upload is a new project
    client.post(f"/api/projects/{second['id']}/classify")
    wait_done(client, second["id"])
    assert client.post("/api/projects/d1/evaluate", json={"handle": "spam-bot"}).json()["decision"] == "FLAG"


def test_graph_trust_and_overview_numbers(env):
    client, _ = env
    sign_up(client, "Arin-J26")
    client.post("/api/projects/d1/classify")
    wait_done(client, "d1")
    graph = client.get("/api/projects/d1/graph").json()
    assert graph["months"] == [
        {"month": "2026-09", "genuine": 2, "spam": 0},
        {"month": "2026-10", "genuine": 0, "spam": 3},
    ]
    trust = client.get("/api/projects/d1/trust").json()
    assert [r["handle"] for r in trust["trusted"]] == ["ada"] and trust["trusted"][0]["trusted_by"] == 1
    assert [r["handle"] for r in trust["not_trusted"]] == ["spam-bot"]
    stats = client.get("/api/projects/d1").json()
    assert stats["vouchers"] == 2 and stats["denounces"] == 3
    assert stats["campaigns"] == 0  # the dashboard uses the default minimum of 5 PRs per campaign


def test_campaign_window_and_minimum_size(env):
    client, app = env
    sign_up(client, "Arin-J26")
    client.post("/api/projects/d1/classify")
    wait_done(client, "d1")
    # Only one project has PRs so far, so a burst inside it is the most a campaign can reach here.
    alone = client.get("/api/projects/d1/campaigns?window_minutes=240&min_size=2").json()
    assert len(alone) == 1 and alone[0]["projects_hit"] == 1
    second = parse_upload(
        app.state.db,
        zip_bytes(dict(D2), [dict(p, url=p["url"].replace("d1-repo", "d2-repo")) for p in PRS_D1[:3]]),
        "Arin-J26",
    )
    client.post(f"/api/projects/{second['id']}/classify")
    wait_done(client, second["id"])
    found = client.get("/api/projects/d1/campaigns?window_minutes=240&min_size=2").json()
    assert len(found) == 1 and found[0]["ai_verdict"] == "spam" and found[0]["projects_hit"] == 2
    assert client.get("/api/projects/d1/campaigns?window_minutes=240&min_size=7").json() == []  # only 6 PRs here
    sug = client.post(f"/api/projects/d1/campaigns/{found[0]['id']}/suggest?window_minutes=240&min_size=2").json()
    assert sug["sent"] is False and all(p["signed"] is False for p in sug["proposals"])


def test_github_check_is_numbers_plus_gemma_summary(env):
    client, _ = env
    sign_up(client, "Arin-J26")
    body = client.get("/api/projects/d1/contributors/ada/github").json()
    assert body["repos_with_merged_prs"] == 4 and body["summary"].startswith("ada has merged")
    assert body["ai"] is True


def test_upload_rules(env):
    client, _ = env
    assert client.post("/api/projects", content=zip_bytes(D1, PRS_D1)).status_code == 401
    sign_up(client, "Arin-J26")
    assert client.post("/api/projects", content=b"not a zip").status_code == 422
    assert client.post("/api/projects", content=zip_bytes({**D1, "id": "Bad Id"}, PRS_D1)).status_code == 422
    stranger = {**D1, "id": "d3", "maintainers": ["Someone-Else"]}
    assert client.post("/api/projects", content=zip_bytes(stranger, PRS_D1)).status_code == 403
    ok = client.post("/api/projects", content=zip_bytes({**D1, "id": "d3", "maintainers": ["Arin-J26"]}, PRS_D1))
    assert ok.status_code == 201 and ok.json()["prs"] == 5
    other = {**D1, "id": "d2", "maintainers": ["Other-Dev"]}  # Arin-J26 uploads a file that does not list them
    assert client.post("/api/projects", content=zip_bytes(other, [])).status_code == 403


def test_unknown_routes_and_bad_bodies_are_json_errors(env):
    client, _ = env
    sign_up(client, "Arin-J26")
    assert client.get("/api/nope").json()["error"].startswith("No API endpoint")
    assert client.post("/api/projects/d1/evaluate", json={}).status_code == 422


def test_frontend_is_served_and_never_cached(env):
    client, _ = env
    r = client.get("/")
    assert r.status_code == 200 and "cache-control" in r.headers and r.headers["cache-control"] == "no-cache"
    assert "cache-control" not in client.get("/api/health").headers


def test_old_synthetic_database_is_moved_aside_not_deleted(tmp_path):
    import sqlite3

    from app.db import Database

    old = tmp_path / "old.db"
    con = sqlite3.connect(old)
    con.execute("CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, public_key TEXT)")
    con.commit()
    con.close()
    db = Database(old)
    assert db.project("anything") is None
    assert list(tmp_path.glob("old.db.old-*")), "the old file must be kept"


def test_uploads_are_new_projects_and_decisions_are_manual(env):
    client, _ = env
    sign_up(client, "Arin-J26")
    client.post("/api/projects/d1/classify")
    wait_done(client, "d1")
    rec = client.get("/api/projects/d1/records?handle=spam-bot").json()
    assert rec["spam_weight"] == 100 and rec["decision"] is None  # all spam, but nothing is blocked automatically
    assert client.put("/api/projects/d1/decisions/spam-bot", json={"action": "block"}).json()["decision"] == "block"
    assert client.get("/api/projects/d1/records?handle=spam-bot").json()["decision"] == "block"
    ev = client.post("/api/projects/d1/evaluate", json={"handle": "spam-bot"}).json()
    assert ev["maintainer_decision"] == "block" and ev["spam_weight"] == 100
    assert client.put("/api/projects/d1/decisions/spam-bot", json={"action": "clear"}).json()["decision"] is None
    assert client.put("/api/projects/d1/decisions/spam-bot", json={"action": "maybe"}).status_code == 422
    row = next(r for r in client.get("/api/projects/d1/trust").json()["not_trusted"] if r["handle"] == "spam-bot")
    assert row["spam_weight"] == 100
    assert client.get("/api/projects/d1").json()["spam_weight"] == 60  # 3 spam of 5 classified
