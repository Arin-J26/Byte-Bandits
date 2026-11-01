"""Build the REAL test network from public GitHub data.

What is real:  the 10 repositories, their recent pull requests (title, body excerpt, diff excerpt,
               timestamps) and the public account creation date of each PR author.
What is NOT:   trust edges and signed records. Nobody publishes trust about real people, so the trust
               graph between the repositories is a labelled synthetic governance graph, and the only
               records are about clearly fictional handles (demo-*) with example.com evidence.

Nothing is posted anywhere. Reads go through the local `gh` CLI (your own login, read-only API calls).

    backend/.venv/bin/python backend/scripts/fetch_github.py            # ~700 API calls, a few minutes
    backend/.venv/bin/python backend/scripts/fetch_github.py --per-repo 20
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.crypto import generate_keypair, sign_record, verify_record  # noqa: E402
from app.trust import compute_trust  # noqa: E402

REPOS = [
    "oppia/oppia",
    "RocketChat/Rocket.Chat",
    "meshery/meshery",
    "AOSSIE-Org/PictoPy",
    "commons-app/apps-android-commons",
    "openfoodfacts/openfoodfacts-androidapp",
    "zulip/zulip",
    "processing/p5.js",
    "metacall/core",
    "scummvm/scummvm",
]
PERSPECTIVE = "oppia-oppia"
OUT = ROOT / "examples" / "input" / "github-real.json"
DIFF_LIMIT = 4000
BODY_LIMIT = 1000


def gh(*args: str, accept: str | None = None) -> str:
    cmd = ["gh", "api", *args]
    if accept:
        cmd += ["-H", f"Accept: {accept}"]
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def slug(repo: str) -> str:
    return repo.replace("/", "-").lower()


def parse_ts(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def account_created(login: str, cache: dict[str, datetime | None]) -> datetime | None:
    if login not in cache:
        try:
            cache[login] = parse_ts(json.loads(gh(f"users/{quote(login, safe='')}"))["created_at"])
        except (subprocess.CalledProcessError, json.JSONDecodeError, KeyError):
            cache[login] = None  # deleted or unreadable account: excluded below, not guessed
    return cache[login]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-repo", type=int, default=30)
    args = ap.parse_args()

    projects, pr_events, skipped = [], [], []
    ages: dict[str, datetime | None] = {}
    for repo in REPOS:
        pid = slug(repo)
        keys = generate_keypair(hashlib.sha256(f"github:{pid}".encode()).digest())
        projects.append({"id": pid, "name": repo, "public_key": keys[1], "max_depth": 3})
        prs = json.loads(gh(f"repos/{repo}/pulls?state=all&sort=created&direction=desc&per_page={args.per_repo}"))
        for pr in prs:
            login = (pr.get("user") or {}).get("login")
            created = parse_ts(pr["created_at"])
            born = account_created(login, ages) if login else None
            if born is None:
                skipped.append(f"{repo}#{pr['number']}")
                continue
            try:
                diff = gh(f"repos/{repo}/pulls/{pr['number']}", accept="application/vnd.github.v3.diff")
            except subprocess.CalledProcessError:
                diff = ""
            pr_events.append(
                {
                    "id": f"{pid}-{pr['number']}",
                    "project_id": pid,
                    "handle": login,
                    "account_age_days": max(0, (created - born).days),
                    "title": (pr.get("title") or "")[:300],
                    "body_excerpt": (pr.get("body") or "")[:BODY_LIMIT],
                    "diff_text": diff[:DIFF_LIMIT],
                    "created_at": created.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "url": pr["html_url"],
                }
            )
        print(f"{repo}: {len(prs)} PRs fetched", file=sys.stderr)

    # ----- synthetic governance graph (labelled in the file) -----
    ids = [p["id"] for p in projects]
    edges = []
    for i, pid in enumerate(ids):
        edges.append({"from": pid, "to": ids[(i + 1) % len(ids)], "weight": 0.8})
        edges.append({"from": pid, "to": ids[(i + 3) % len(ids)], "weight": 0.5})
    trust, _ = compute_trust(edges, PERSPECTIVE, 0.8, 3)
    direct = sorted(k for k, v in trust.items() if v.hops == 1)
    if len(direct) < 2:
        raise SystemExit("perspective needs at least two direct peers")

    # ----- signed demo records about fictional handles only -----
    keypairs = {p["id"]: generate_keypair(hashlib.sha256(f"github:{p['id']}".encode()).digest()) for p in projects}
    records = []

    def add(issuer, handle, type_, reason, n):
        rec = {
            "id": f"demo-rec-{len(records) + 1:03d}",
            "issuer": issuer,
            "subject_handle": handle,
            "type": type_,
            "reason": reason,
            "evidence_urls": [f"https://example.com/demo/{handle}/{n}"],
            "timestamp": "2026-10-20T12:00:00Z",
        }
        rec["signature"] = sign_record(rec, keypairs[issuer][0])
        rec["signature_valid"] = verify_record(rec, keypairs[issuer][1])
        records.append(rec)

    add(direct[0], "demo-vouched-contributor", "vouch", "Demo vouch: two merged example PRs", 1)
    add(direct[1], "demo-vouched-contributor", "vouch", "Demo vouch: docs improvements", 2)
    add(direct[0], "demo-flagged-account", "denounce", "Demo denounce: templated PRs", 3)
    add(direct[1], "demo-flagged-account", "denounce", "Demo denounce: templated PRs", 4)
    add(direct[0], "demo-lone-denounce", "denounce", "Demo: a single mistaken denounce", 5)

    network = {
        "_notice": (
            "REAL data: repositories, pull requests, diff excerpts and public account creation dates from GitHub, "
            f"fetched {datetime.now(UTC).strftime('%Y-%m-%d')} by backend/scripts/fetch_github.py. "
            "SYNTHETIC: trust_edges (a governance graph chosen for the test) and records (only demo-* handles, "
            "example.com evidence). No real person is the subject of any record."
        ),
        "perspective": PERSPECTIVE,
        "projects": projects,
        "trust_edges": edges,
        "records": records,
        "pr_events": sorted(pr_events, key=lambda e: e["created_at"]),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(network, indent=2, ensure_ascii=False) + "\n")
    size = OUT.stat().st_size / 1024 / 1024
    print(
        f"wrote {OUT.relative_to(ROOT)}: {len(projects)} repos, {len(pr_events)} PRs, {size:.1f} MB; "
        f"skipped {len(skipped)} PRs with unreadable authors",
        file=sys.stderr,
    )
    if size > 4.5:
        raise SystemExit("file is close to the 5 MB import limit; use --per-repo 20")


if __name__ == "__main__":
    main()
