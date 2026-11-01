"""The synthetic test project D2: 13 spam accounts, a 38-PR campaign over 107 minutes, and random spam weights.
Gemma is replaced by a fixed rule (typo PRs from spam accounts are spam), so these tests run offline."""

import io
import json
import sys
import zipfile
from pathlib import Path

import pytest

from app import analysis
from app.db import Database
from app.ingest import parse_upload
from app.llm import LLM
from app.models import PrVerdict

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from make_test_project import SPAM_ACCOUNTS, SPAM_TITLE, build  # noqa: E402


class Rule(LLM):
    def classify_pr(self, pr):
        spam = pr["title"] == SPAM_TITLE and pr["author"].startswith("test-spam")
        return PrVerdict(spam=spam, reason="rule"), True


@pytest.fixture(scope="module")
def loaded(tmp_path_factory):
    meta, prs = build()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("project.json", json.dumps(meta))
        zf.writestr("prs.json", json.dumps(prs))
    db = Database(tmp_path_factory.mktemp("d2") / "d2.db")
    parse_upload(db, buf.getvalue(), "Arin-J26", replace=True, trusted=True)
    for pr in db.prs("d2"):
        verdict, _ = Rule().classify_pr(pr)
        db.save_classification(pr["id"], "spam" if verdict.spam else "genuine", verdict.reason, True)
    return db


def test_wave_is_38_typo_prs_in_107_minutes():
    _, prs = build()
    wave = [p for p in prs if p["title"] == SPAM_TITLE]
    assert len(wave) == 38 and len({p["author"] for p in wave}) == SPAM_ACCOUNTS
    times = sorted(p["created_at"] for p in wave)
    assert times[0][:16] != times[-1][:16]


def test_campaign_matches_the_original_demo(loaded):
    project = loaded.project("d2")
    found = analysis.campaigns_for(loaded, project, loaded.projects_for("Arin-J26"), 240, 5)
    assert len(found) == 1
    c = found[0]
    assert c["size"] == SPAM_ACCOUNTS and len(c["pr_events"]) == 38
    assert c["window_minutes"] == 107 and c["accounts_min_age_days"] == 3


def test_spam_weights_vary_and_come_from_labels(loaded):
    shares = {}
    for p in loaded.prs("d2"):
        if p["author"].startswith("test-spam"):
            s = shares.setdefault(p["author"], [0, 0])
            s[0 if p["label"] == "spam" else 1] += 1
    weights = sorted(round(100 * s / (s + g)) for s, g in shares.values())
    assert len(weights) == SPAM_ACCOUNTS
    assert weights[-1] == 100 and weights[0] < 50
    assert len(set(weights)) > 3
