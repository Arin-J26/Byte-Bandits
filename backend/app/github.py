"""Read-only checks against GitHub's public REST API (no GitHub token is required, but one raises the limit).

Nothing here writes to GitHub. GitHub has no "vouch" or "denounce" feature, so the contributor check reports
the public facts that exist: which other repositories have merged this author's PRs, and when the account was made.
"""

from __future__ import annotations

import os
import re
import time
from datetime import UTC, datetime

import httpx

from .db import Database

API = "https://api.github.com"
USER_TTL = 7 * 24 * 3600
STATS_TTL = 12 * 3600
LOGIN_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?(?:\[bot\])?$")


class GitHubError(Exception):
    """GitHub could not answer (not found, rate limited, or unreachable)."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def _headers() -> dict[str, str]:
    h = {"Accept": "application/vnd.github+json", "User-Agent": "sniffer-backend"}
    if token := os.environ.get("GITHUB_TOKEN"):
        h["Authorization"] = f"Bearer {token}"
    return h


def get(path: str, params: dict | None = None, accept: str | None = None) -> httpx.Response:
    headers = _headers() | ({"Accept": accept} if accept else {})
    try:
        r = httpx.get(f"{API}{path}", params=params, headers=headers, timeout=8)
    except httpx.HTTPError as err:
        raise GitHubError(f"GitHub is unreachable: {err.__class__.__name__}") from err
    if r.status_code in (403, 429) and "rate limit" in r.text.lower():
        raise GitHubError("GitHub rate limit reached; try again later or set GITHUB_TOKEN", 429)
    if r.status_code == 404:
        raise GitHubError("Not found on GitHub", 404)
    if r.status_code >= 400:
        raise GitHubError(f"GitHub returned HTTP {r.status_code}")
    return r


def valid_login(login: str) -> bool:
    return bool(LOGIN_RE.match(login or ""))


def user(db: Database, login: str) -> dict:
    """Public profile of a GitHub user (cached for a week). Raises GitHubError 404 when the user does not exist."""
    key = f"user:{login.lower()}"
    hit = db.gh_get(key)
    now = int(time.time())
    if hit and now - hit["fetched_at"] < USER_TTL:
        return hit["value"]
    data = get(f"/users/{login}").json()
    value = {"login": data["login"], "created_at": data["created_at"], "public_repos": data.get("public_repos", 0)}
    db.gh_put(key, value, now)
    return value


def account_age_days(created_at: str, at: datetime | None = None) -> int:
    born = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    return max(0, ((at or datetime.now(UTC)) - born).days)


def contributor_stats(db: Database, login: str, exclude_repo: str | None = None) -> dict:
    """What GitHub publicly shows about a contributor's accepted work, excluding the project being checked."""
    key = f"stats:{login.lower()}:{(exclude_repo or '').lower()}"
    hit = db.gh_get(key)
    now = int(time.time())
    if hit and now - hit["fetched_at"] < STATS_TTL:
        return {**hit["value"], "cached": True}
    profile = user(db, login)
    search = get("/search/issues", {"q": f"author:{login} type:pr is:merged", "per_page": 100}).json()
    repos = {}
    for item in search.get("items", []):
        full = item["repository_url"].split("/repos/", 1)[-1]
        if exclude_repo and full.lower() == exclude_repo.lower():
            continue
        repos[full] = repos.get(full, 0) + 1
    value = {
        "login": profile["login"],
        "account_created": profile["created_at"],
        "account_age_days": account_age_days(profile["created_at"]),
        "public_repos": profile["public_repos"],
        "merged_prs_found": search.get("total_count", 0),
        "repos_with_merged_prs": len(repos),
        "top_repos": sorted(repos, key=lambda r: -repos[r])[:5],
        "search_capped": search.get("total_count", 0) > len(search.get("items", [])),
    }
    db.gh_put(key, value, now)
    return {**value, "cached": False}


def pull_request_diff(repo: str, number: int) -> str:
    return get(f"/repos/{repo}/pulls/{number}", accept="application/vnd.github.v3.diff").text
