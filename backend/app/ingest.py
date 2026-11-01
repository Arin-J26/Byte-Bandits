"""Read a project zip file uploaded by a maintainer.

Format (the zip may hold these files at its root, or inside one top-level folder):

  project.json   required  {"id": "d1", "name": "D1", "github": "owner/repo", "maintainers": ["login", ...]}
  prs.json       optional  [{"number", "author", "title", "body", "created_at", "merged", "url", "diff",
                              "account_age_days"?}, ...]

Without prs.json, the most recent pull requests are fetched from GitHub's public API (set GITHUB_TOKEN to raise
the rate limit). Zips are capped at 5 MB, with 20 MB uncompressed in total, to limit zip bombs.
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from datetime import UTC, datetime

from pydantic import BaseModel, Field, ValidationError, field_validator

from . import github
from .db import Database

MAX_ZIP_BYTES = 5 * 1024 * 1024
MAX_UNCOMPRESSED = 20 * 1024 * 1024
MAX_PRS = 500
DIFF_LIMIT = 4000
BODY_LIMIT = 1500
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


class IngestError(Exception):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


class ProjectFile(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=120)
    github: str = Field(pattern=r"^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")
    maintainers: list[str] = Field(min_length=1, max_length=20)

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        if not ID_RE.match(v):
            raise ValueError("id must be lowercase letters, digits and dashes (for example 'd1')")
        return v

    @field_validator("maintainers")
    @classmethod
    def _logins(cls, v: list[str]) -> list[str]:
        bad = [m for m in v if not github.valid_login(m)]
        if bad:
            raise ValueError(f"not valid GitHub usernames: {', '.join(bad[:3])}")
        return v


class PrFile(BaseModel):
    number: int = Field(ge=1)
    author: str
    title: str = Field(max_length=500)
    body: str = Field(default="", max_length=20_000)
    created_at: str
    merged: bool
    url: str = Field(max_length=300)
    diff: str = Field(default="", max_length=200_000)
    account_age_days: int | None = Field(default=None, ge=0, le=100_000)

    @field_validator("created_at")
    @classmethod
    def _ts(cls, v: str) -> str:
        datetime.fromisoformat(v.replace("Z", "+00:00"))
        return v


def _read_members(raw: bytes, trusted: bool = False) -> dict[str, bytes]:
    if not trusted and len(raw) > MAX_ZIP_BYTES:
        raise IngestError("The zip is larger than 5 MB.", 413)
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as err:
        raise IngestError("The upload is not a valid zip file.") from err
    files, total = {}, 0
    for info in zf.infolist():
        if info.is_dir():
            continue
        total += info.file_size
        if not trusted and total > MAX_UNCOMPRESSED:
            raise IngestError("The zip expands to more than 20 MB.", 413)
        name = info.filename.split("/")[-1]  # accept one top-level folder
        if name in ("project.json", "prs.json"):
            files[name] = zf.read(info)
    return files


def parse_upload(
    db: Database,
    raw: bytes,
    uploader: str,
    *,
    override: dict | None = None,
    source_note: str = "",
    replace: bool = False,
    trusted: bool = False,
) -> dict:
    """Store a project from a zip. Every upload becomes a NEW project (its id is made unique), unless `replace`.

    `override` supplies project.json fields for a zip that is only a repository snapshot (no project.json).
    `trusted` is for the operator command line only: it skips the upload size limits.
    """
    members = _read_members(raw, trusted=trusted)
    if "project.json" in members:
        try:
            meta = ProjectFile(**json.loads(members["project.json"]))
        except (json.JSONDecodeError, ValidationError) as err:
            raise IngestError(f"project.json is not valid: {_first_error(err)}") from err
    elif override:
        try:
            meta = ProjectFile(**override)
        except ValidationError as err:
            raise IngestError(f"project details are not valid: {_first_error(err)}") from err
    else:
        raise IngestError("The zip must contain project.json (see the upload help).")
    if uploader.lower() not in [m.lower() for m in meta.maintainers]:
        raise IngestError("You are not listed as a maintainer in this project.", 403)

    if replace:
        existing = db.project(meta.id)
        if existing and uploader.lower() not in [m.lower() for m in existing["maintainers"]]:
            raise IngestError(f"Project '{meta.id}' exists and you are not one of its maintainers.", 403)
    else:
        meta = meta.model_copy(update={"id": db.unique_project_id(meta.id)})

    if "prs.json" in members:
        prs = _from_file(members["prs.json"])
        source = "zip (prs.json)"
    else:
        prs = _from_github(db, meta)
        source = "GitHub public API"
    note = f"{source_note}; PRs from {source}" if source_note else source
    db.save_project(meta.model_dump(), prs, uploader, source=note, replace=replace)
    return {
        "id": meta.id,
        "name": meta.name,
        "github": meta.github,
        "maintainers": meta.maintainers,
        "prs": len(prs),
        "merged": sum(1 for p in prs if p["merged"]),
        "source": note,
    }


def _first_error(err: Exception) -> str:
    if isinstance(err, ValidationError):
        e = err.errors()[0]
        return f"{'.'.join(str(x) for x in e['loc'])}: {e['msg']}"
    return "not JSON"


def _from_file(raw: bytes) -> list[dict]:
    try:
        items = json.loads(raw)
        if not isinstance(items, list):
            raise ValueError("expected a list")
        if len(items) > MAX_PRS:
            raise IngestError(f"prs.json has more than {MAX_PRS} pull requests.")
        return [_normalise(PrFile(**i)) for i in items]
    except (json.JSONDecodeError, ValidationError, ValueError) as err:
        raise IngestError(
            f"prs.json is not valid: {_first_error(err) if isinstance(err, ValidationError) else err}"
        ) from err


def _normalise(p: PrFile) -> dict:
    return {
        "number": p.number,
        "author": p.author,
        "title": p.title,
        "body": p.body[:BODY_LIMIT],
        "diff_text": p.diff[:DIFF_LIMIT],
        "created_at": p.created_at,
        "merged": p.merged,
        "url": p.url,
        "account_age_days": p.account_age_days,
    }


def _from_github(db: Database, meta: ProjectFile, per_page: int = 30) -> list[dict]:
    """Recent pull requests. Diffs are fetched for the first `per_page` only, to stay within limits."""
    try:
        items = github.get(
            f"/repos/{meta.github}/pulls",
            {"state": "all", "sort": "created", "direction": "desc", "per_page": per_page},
        ).json()
    except github.GitHubError as err:
        raise IngestError(f"Could not read pull requests from GitHub: {err}", err.status) from err
    prs = []
    for i, pr in enumerate(items):
        author = (pr.get("user") or {}).get("login") or "ghost"
        age = None
        try:
            age = github.account_age_days(github.user(db, author)["created_at"])
        except github.GitHubError:
            pass
        diff = ""
        if i < per_page:
            try:
                diff = github.pull_request_diff(meta.github, pr["number"])
            except github.GitHubError:
                diff = ""
        prs.append(
            {
                "number": pr["number"],
                "author": author,
                "title": (pr.get("title") or "")[:500],
                "body": (pr.get("body") or "")[:BODY_LIMIT],
                "diff_text": diff[:DIFF_LIMIT],
                "created_at": pr["created_at"],
                "merged": bool(pr.get("merged_at")),
                "url": pr["html_url"],
                "account_age_days": age,
            }
        )
    return prs


def now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def split_bundle(raw: bytes) -> dict[str, bytes]:
    """Split a bundle zip (one folder per project, each with project.json and optionally prs.json) into one
    single-project zip per folder. Returns {} when the zip is not a bundle."""
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        names = set(zf.namelist())
        folders = sorted({n.rsplit("/", 1)[0] for n in names if n.endswith("project.json") and "/" in n})
        out: dict[str, bytes] = {}
        for folder in folders:
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w") as single:
                for name in ("project.json", "prs.json"):
                    if f"{folder}/{name}" in names:
                        single.writestr(name, zf.read(f"{folder}/{name}"))
            out[folder.split("/")[-1]] = buf.getvalue()
    return out
