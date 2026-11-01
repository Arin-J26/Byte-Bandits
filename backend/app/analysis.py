"""Turns a project's pull requests and Gemma's classifications into the numbers shown in the app.

Each contributor's PRs in one project become one summary record per project, so the trust engine sees one
opinion per (project, contributor): "denounce" when most of their PRs were classified spam, "vouch" when any
were genuine. Evidence is the PR links. Nothing here is hard-coded data.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime

from . import trust
from .campaigns import CampaignConfig, detect
from .db import Database

TRUST_EDGE_WEIGHT = 0.8  # projects that one maintainer manages trust each other by default
SPAM_SHARE_FOR_DENOUNCE = 0.5


def label_counts(prs: list[dict]) -> Counter:
    return Counter(p.get("label") or "pending" for p in prs)


def derived_records(db: Database, projects: list[dict]) -> list[dict]:
    """One summary record per (project, contributor), built from classified PRs only."""
    records = []
    for proj in projects:
        by_author: dict[str, list[dict]] = defaultdict(list)
        for p in db.prs(proj["id"]):
            if p.get("label") in ("spam", "genuine"):
                by_author[p["author"]].append(p)
        for author, prs in by_author.items():
            spam = [p for p in prs if p["label"] == "spam"]
            genuine = [p for p in prs if p["label"] == "genuine"]
            denounce = len(spam) / len(prs) > SPAM_SHARE_FOR_DENOUNCE or len(spam) >= 2 and len(spam) >= len(genuine)
            chosen = spam if denounce else genuine
            if not chosen:
                continue
            latest = max(chosen, key=lambda p: p["created_at"])
            records.append(
                {
                    "id": f"{proj['id']}:{author.lower()}",
                    "issuer": proj["id"],
                    "subject_handle": author,
                    "type": "denounce" if denounce else "vouch",
                    "reason": (
                        f"{len(spam)} of {len(prs)} PRs classified spam by Gemma"
                        if denounce
                        else f"{len(genuine)} genuine PR(s) merged or proposed; none classified spam"
                    ),
                    "evidence_urls": [p["url"] for p in chosen[:5]],
                    "timestamp": latest["created_at"],
                    "signature_valid": True,
                }
            )
    return records


def trust_edges(projects: list[dict], perspective: str) -> list[dict]:
    """Projects managed by the same maintainer trust each other (default weight, stated in the README)."""
    return [
        {"from": perspective, "to": p["id"], "weight": TRUST_EDGE_WEIGHT} for p in projects if p["id"] != perspective
    ]


def evaluate_contributor(db: Database, project: dict, all_projects: list[dict], handle: str) -> dict:
    """The same decision function as before, fed with this maintainer's real classifications."""
    records = derived_records(db, all_projects)
    edges = trust_edges(all_projects, project["id"])
    return trust.evaluate(edges, records, project["id"], handle)


def project_stats(db: Database, project: dict, all_projects: list[dict]) -> dict:
    prs = db.prs(project["id"])
    counts = label_counts(prs)
    records = derived_records(db, all_projects)
    trusted_here = {
        r["subject_handle"].lower() for r in records if r["issuer"] == project["id"] and r["type"] == "vouch"
    }
    authors = {p["author"].lower() for p in prs}
    flagged = 0
    for handle in authors:
        if (
            trust.evaluate(trust_edges(all_projects, project["id"]), records, project["id"], handle)["decision"]
            == "FLAG"
        ):
            flagged += 1
    campaigns = campaigns_for(db, project, all_projects, 240, 5)
    return {
        "id": project["id"],
        "name": project["name"],
        "github": project["github"],
        "prs_total": len(prs),
        "merged_prs": sum(1 for p in prs if p["merged"]),
        "vouchers": counts.get("genuine", 0),
        "denounces": counts.get("spam", 0),
        "trust_edges": len(trusted_here),
        "flagged_accounts": flagged,
        "campaigns": len(campaigns),
        "classified": len(prs) - counts.get("pending", 0) - counts.get("unclassified", 0),
        "spam_weight": spam_weight(prs),
        "unclassified": counts.get("pending", 0) + counts.get("unclassified", 0),
        "source": project.get("source", ""),
    }


def contributors(db: Database, project: dict, all_projects: list[dict]) -> list[dict]:
    """Per contributor in this project: trust counts (across the maintainer's projects), this project's PR counts,
    the spam weight (share of their classified PRs that are spam), and the maintainer's decision, if any."""
    records = derived_records(db, all_projects)
    by = defaultdict(lambda: {"handle": "", "trusted_by": 0, "not_trusted_by": 0, "prs": 0, "genuine": 0, "spam": 0})
    for r in records:
        row = by[r["subject_handle"].lower()]
        row["handle"] = r["subject_handle"]
        if r["type"] == "vouch":
            row["trusted_by"] += 1
        else:
            row["not_trusted_by"] += 1
    own = {}
    for p in db.prs(project["id"]):
        row = by[p["author"].lower()]
        row["handle"] = p["author"]
        row["prs"] += 1
        row["genuine"] += p.get("label") == "genuine"
        row["spam"] += p.get("label") == "spam"
        own[p["author"].lower()] = True
    decided = db.decisions(project["id"])
    rows = []
    for key, row in by.items():
        if key not in own:  # counts draw on all projects; the list shows only people who have PRs here
            continue
        classified = row["genuine"] + row["spam"]
        row["spam_weight"] = round(100 * row["spam"] / classified) if classified else None
        row["decision"] = decided.get(key)
        rows.append(row)
    return rows


def spam_weight(stats_prs: list[dict]) -> int | None:
    classified = [p for p in stats_prs if p.get("label") in ("spam", "genuine")]
    if not classified:
        return None
    return round(100 * sum(p["label"] == "spam" for p in classified) / len(classified))


def graph_series(db: Database, project: dict) -> list[dict]:
    """Genuine vs spam PRs per month, for the bar chart."""
    months: dict[str, Counter] = defaultdict(Counter)
    for p in db.prs(project["id"]):
        if p.get("label") in ("spam", "genuine"):
            month = datetime.fromisoformat(p["created_at"].replace("Z", "+00:00")).strftime("%Y-%m")
            months[month][p["label"]] += 1
    return [{"month": m, "genuine": months[m]["genuine"], "spam": months[m]["spam"]} for m in sorted(months)]


def _events(prs: list[dict]) -> list[dict]:
    """Shape stored PRs like the campaign detector's input. Unknown account age counts as established."""
    return [
        {
            "id": p["id"],
            "project_id": p["project_id"],
            "handle": p["author"],
            "title": p["title"],
            "diff_text": p["diff_text"],
            "body_excerpt": p["body"],
            "created_at": p["created_at"],
            "account_age_days": p["account_age_days"] if p["account_age_days"] is not None else 10_000,
        }
        for p in prs
    ]


def campaigns_for(
    db: Database, project: dict, all_projects: list[dict], window_minutes: int, min_size: int
) -> list[dict]:
    """Coordinated bursts across the maintainer's projects, keeping those that include this project's PRs."""
    prs = [p for proj in all_projects for p in db.prs(proj["id"])]
    # Any burst of near-identical, young-account PRs counts. A campaign reports how many projects it reaches.
    cfg = CampaignConfig(min_projects=1, max_window_minutes=window_minutes, min_events=min_size)
    found = detect(_events(prs), cfg)
    return [c for c in found if any(e["project"] == project["id"] for e in c["pr_events"])]
