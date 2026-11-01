"""Load a project from the command line, as one of its maintainers. Used for the first project (sign-up needs a
listed project) and for repository zips, which can be larger than the 5 MB upload limit.

A zip with project.json loads as it is. A repository zip (no project.json) needs --id, --name and --github:

    backend/.venv/bin/python backend/scripts/load_project.py d1.zip --as Arin-J26
    backend/.venv/bin/python backend/scripts/load_project.py oppia-develop.zip --as Arin-J26 \\
        --id d1 --name "D1 (oppia)" --github oppia/oppia --maintainers Arin-J26,Adi_26 --replace

Each run creates a new project unless --replace is given (that overwrites the project with the same id).
Pull requests come from GitHub unless the zip has prs.json.
"""

from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import Database  # noqa: E402
from app.ingest import IngestError, parse_upload, split_bundle  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("zip", type=Path)
    ap.add_argument("--as", dest="login", required=True, help="GitHub login of the uploading maintainer")
    ap.add_argument("--id", help="project id, for example d1 (repository zips)")
    ap.add_argument("--name", help="display name (repository zips)")
    ap.add_argument("--github", help="owner/repo on GitHub (repository zips)")
    ap.add_argument("--maintainers", help="comma-separated GitHub logins (default: --as)")
    ap.add_argument("--replace", action="store_true", help="overwrite the project with this id")
    args = ap.parse_args()

    override = None
    if args.id or args.name or args.github:
        if not (args.id and args.name and args.github):
            raise SystemExit("--id, --name and --github must be given together")
        maintainers = [m.strip() for m in (args.maintainers or args.login).split(",") if m.strip()]
        override = {"id": args.id, "name": args.name, "github": args.github, "maintainers": maintainers}

    db = Database()
    raw = args.zip.read_bytes()
    folders = split_bundle(raw)
    if folders:  # a bundle: one folder per project, each loaded as its own project (an existing id is replaced)
        for folder, single in folders.items():
            try:
                summary = parse_upload(
                    db, single, args.login, source_note=f"{args.zip.name}/{folder}", replace=True, trusted=True
                )
            except IngestError as err:
                raise SystemExit(f"{folder} not loaded: {err}") from err
            print(f"loaded {summary['id']} ({summary['github']}): {summary['prs']} PRs, {summary['merged']} merged")
        print(f"bundle {args.zip.name}: {len(folders)} projects")
        return
    with zipfile.ZipFile(args.zip) as zf:
        files = sum(1 for i in zf.infolist() if not i.is_dir())
    source_note = f"{args.zip.name} ({files} files)"
    try:
        summary = parse_upload(
            db, raw, args.login, override=override, source_note=source_note, replace=args.replace, trusted=True
        )
    except IngestError as err:
        raise SystemExit(f"not loaded: {err}") from err
    print(f"loaded {summary['id']} ({summary['github']}): {summary['prs']} PRs, {summary['merged']} merged")
    print(f"source: {summary['source']}")


if __name__ == "__main__":
    main()
