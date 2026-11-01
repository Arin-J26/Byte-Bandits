"""Build the SYNTHETIC test project D2: fictional contributors and invented pull requests. No real person is involved.

    backend/.venv/bin/python backend/scripts/make_test_project.py examples/input/synthetic-d2.zip

- Campaign: 13 spam accounts open 38 near-identical typo PRs within 107 minutes. The accounts are 3 days old.
- Random spam weight: each spam account gets a random target (5-100%) and enough genuine PRs to reach it.
  Gemma's labels, not these numbers, decide what the app shows.
- 15 genuine contributors open varied PRs over a long period. They are never clustered.
"""

from __future__ import annotations

import io
import json
import random
import sys
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

SPAM_ACCOUNTS = 13
GENUINE_ACCOUNTS = 15
WAVE_MINUTES = 107
WAVE_START = datetime(2026, 10, 20, 10, 0, tzinfo=UTC) + timedelta(days=61)
SPAM_TITLE = "Fix typo in README.md"
SPAM_DIFF = "--- a/README.md\n+++ b/README.md\n-Teh quick start guide.\n+The quick start guide.\n"
TITLES = [
    "Add retry with backoff to the uploader",
    "Fix off-by-one in pagination helper",
    "Document the release checklist",
    "Speed up startup by lazy-loading plugins",
    "Handle empty input in the CLI parser",
    "Add unit tests for date parsing",
    "Support YAML configuration files",
    "Fix memory leak in the event bus",
    "Improve error message for missing config",
    "Add dark mode toggle to settings",
    "Refactor cache key generation",
    "Fix race in the job scheduler",
    "Validate webhook signatures",
    "Add example for custom themes",
    "Translate onboarding guide to Hindi",
]


def code_diff(rng: random.Random, tag: str) -> str:
    """A small, varied code change, so genuine PRs never look near-identical to each other."""
    words = [w.lower() for w in tag.split() if w.isalpha()] or ["fix"]
    name = f"src/{rng.choice(words)}_{rng.randint(1, 999)}.py"
    fn = "_".join(rng.sample(words, min(3, len(words))))
    return (
        f"--- a/{name}\n+++ b/{name}\n+def {fn}(value, limit={rng.randint(2, 500)}):\n"
        f"+    # {rng.choice(words)} {rng.randint(1, 10_000)}\n+    return value[:limit] if value else None\n"
    )


def build() -> tuple[dict, list[dict]]:
    rng = random.Random(2026)
    number = 100
    prs: list[dict] = []

    def add(login: str, title: str, body: str, when: datetime, diff: str, age: int, merged: bool) -> None:
        nonlocal number
        number += 1
        prs.append(
            {
                "number": number,
                "author": login,
                "title": title,
                "body": body,
                "created_at": when.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "merged": merged,
                "url": f"https://github.com/test-org/synthetic-d2/pull/{number}",
                "diff": diff,
                "account_age_days": age,
            }
        )

    spam_logins = [f"test-spam-{i + 1:02d}" for i in range(SPAM_ACCOUNTS)]
    for i in range(38):  # the wave: 38 typo PRs spread over the 107 minutes
        login = spam_logins[i % SPAM_ACCOUNTS]
        when = WAVE_START + timedelta(minutes=round(i * WAVE_MINUTES / 37))
        add(login, SPAM_TITLE, "Small fix.", when, SPAM_DIFF, 3, merged=False)
    # Each spam account gets a random target spam weight; genuine PRs are added to reach it, so the weights spread
    # from about 5% to 100%.
    targets = [100, 95, 88, 80, 70, 62, 50, 42, 33, 25, 18, 10, 5]
    rng.shuffle(targets)
    for login, target in zip(spam_logins, targets, strict=True):
        spam = sum(1 for p in prs if p["author"] == login)
        for _ in range(round(spam * (100 - target) / target)):
            title = rng.choice(TITLES)
            when = WAVE_START - timedelta(days=rng.randint(5, 90), minutes=rng.randint(0, 1400))
            add(
                login,
                title,
                f"Adds a focused change: {title.lower()}.",
                when,
                code_diff(rng, title),
                3,
                merged=rng.random() < 0.7,
            )
    for i in range(GENUINE_ACCOUNTS):
        login = f"test-genuine-{i + 1:02d}"
        age = rng.randint(300, 2000)
        for _ in range(rng.randint(4, 8)):
            title = rng.choice(TITLES)
            when = WAVE_START + timedelta(days=rng.randint(-60, 30), minutes=rng.randint(0, 600))
            add(
                login,
                title,
                f"Adds a focused change: {title.lower()}. Includes tests.",
                when,
                code_diff(rng, title),
                age,
                merged=rng.random() < 0.8,
            )
    prs.sort(key=lambda r: r["created_at"])
    meta = {
        "id": "d2",
        "name": "D2 (synthetic)",
        "github": "test-org/synthetic-d2",
        "maintainers": ["Arin-J26"],
        "_notice": "SYNTHETIC test project. Fictional contributors and invented pull requests.",
    }
    return meta, prs


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "examples/input/synthetic-d2.zip")
    out.parent.mkdir(parents=True, exist_ok=True)
    meta, prs = build()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("project.json", json.dumps(meta, indent=2) + "\n")
        zf.writestr("prs.json", json.dumps(prs, indent=2) + "\n")
    out.write_bytes(buf.getvalue())
    print(f"wrote {out}: {len(prs)} PRs")


if __name__ == "__main__":
    main()
