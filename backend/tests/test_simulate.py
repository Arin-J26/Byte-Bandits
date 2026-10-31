from datetime import UTC, datetime

import pytest

from app.crypto import verify_record
from app.simulate import ME, generate_network
from app.trust import evaluate

NOW = datetime(2026, 11, 1, tzinfo=UTC)


@pytest.fixture(scope="module")
def net():
    return generate_network(projects=40, newcomers=8, campaign_size=38, seed=2026)


def ev(net, handle):
    return evaluate(net["trust_edges"], net["records"], ME, handle, now=NOW)


def test_reproducible(net):
    again = generate_network(projects=40, newcomers=8, campaign_size=38, seed=2026)
    assert again == net
    assert generate_network(seed=7) != net


def test_sizes_and_keys(net):
    assert len(net["projects"]) == 40
    assert all(len(p["public_key"]) == 64 and p["private_key"] for p in net["projects"])
    assert sum(1 for e in net["pr_events"] if e["account_age_days"] == 3) == 38


def test_exactly_one_invalid_signature(net):
    keys = {p["id"]: p["public_key"] for p in net["projects"]}
    bad = [r for r in net["records"] if not verify_record(r, keys[r["issuer"]])]
    assert [r["subject_handle"] for r in bad] == ["ivan-invalid"]
    assert all(r["signature_valid"] == verify_record(r, keys[r["issuer"]]) for r in net["records"])


def test_every_denounce_has_evidence(net):
    assert all(r["evidence_urls"] for r in net["records"] if r["type"] == "denounce")


def test_demo_story(net):
    ada = ev(net, "ada-commits")
    assert ada["decision"] == "ALLOW"
    reasons = {i["reason"] for i in ada["ignored"]}
    assert "not in your trust graph" in reasons and "beyond depth limit (3 hops)" in reasons
    assert ev(net, "newbie-nora")["decision"] == "UNKNOWN"
    assert ev(net, "borderline-ben")["decision"] == "ALLOW"
    assert ev(net, "solo-denounce-sam")["decision"] == "REVIEW"
    assert ev(net, "ivan-invalid")["decision"] == "UNKNOWN"
    for h in net["spam_handles"]:
        assert ev(net, h)["decision"] == "FLAG", h
    carl = ev(net, "contested-carl")
    assert any(p["type"] == "contest" for p in carl["path"])
    assert carl["decision"] != "FLAG"


def test_lowering_pyforge_flips_borderline_ben(net):
    edges = [dict(e, weight=0.5) if (e["from"], e["to"]) == (ME, "pyforge") else e for e in net["trust_edges"]]
    assert evaluate(edges, net["records"], ME, "borderline-ben", now=NOW)["decision"] == "REVIEW"


@pytest.mark.parametrize("n", [20, 50])
def test_project_count_bounds(n):
    net = generate_network(projects=n, seed=1)
    assert len(net["projects"]) == n
    assert evaluate(net["trust_edges"], net["records"], ME, "ada-commits", now=NOW)["decision"] == "ALLOW"
