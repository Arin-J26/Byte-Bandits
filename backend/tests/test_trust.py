from datetime import UTC, datetime

import pytest

from app.trust import TrustConfig, compute_trust, evaluate

NOW = datetime(2026, 11, 1, tzinfo=UTC)
CHAIN = [{"from": "me", "to": "a", "weight": 1.0}, {"from": "a", "to": "b", "weight": 1.0}]
_n = 0


def rec(issuer, handle, type_="vouch", ts="2026-10-30T00:00:00Z", valid=True):
    global _n
    _n += 1
    return {
        "id": f"r{_n}",
        "issuer": issuer,
        "subject_handle": handle,
        "type": type_,
        "reason": "x",
        "evidence_urls": ["https://example.com/e"],
        "timestamp": ts,
        "signature_valid": valid,
    }


def ev(records, handle, edges=CHAIN, **cfg):
    return evaluate(edges, records, "me", handle, TrustConfig(**cfg), now=NOW)


def test_two_hops_of_full_trust_give_0_8_then_0_64():
    trust, _ = compute_trust(CHAIN, "me", decay=0.8)
    assert trust["a"].trust == pytest.approx(0.8)
    assert trust["b"].trust == pytest.approx(0.64)


def test_depth_cutoff():
    edges = [*CHAIN, {"from": "b", "to": "c", "weight": 1.0}]
    res = ev([rec("c", "ada")], "ada", edges=edges, max_depth=2)
    assert res["decision"] == "UNKNOWN"
    assert res["ignored"][0]["reason"] == "beyond depth limit (2 hops)"


def test_untrusted_and_invalid_records_are_ignored_with_reasons():
    res = ev([rec("a", "ada"), rec("stranger", "ada", "denounce"), rec("a", "ada", valid=False)], "ada")
    assert res["decision"] == "ALLOW"
    reasons = {i["reason"] for i in res["ignored"]}
    assert reasons == {"not in your trust graph", "invalid signature"}


def test_no_records_is_unknown_not_blocked():
    res = ev([], "newbie")
    assert res["decision"] == "UNKNOWN" and res["score"] == 0
    assert "Normal review, not blocked" in res["summary"]


def test_one_denounce_alone_is_review_not_flag():
    res = ev([rec("me", "sam", "denounce")], "sam")
    assert res["score"] <= -0.5
    assert res["decision"] == "REVIEW"


def test_two_independent_trusted_denounces_flag():
    res = ev(
        [rec("me", "spam", "denounce", "2026-10-30T00:00:00Z"), rec("a", "spam", "denounce", "2026-10-30T01:00:00Z")],
        "spam",
    )
    assert res["decision"] == "FLAG"


def test_denounce_decays_with_age():
    fresh = ev([rec("a", "x", "denounce", "2026-10-31T00:00:00Z")], "x")
    old = ev([rec("a", "x", "denounce", "2025-11-01T00:00:00Z")], "x")
    assert abs(old["path"][0]["effect"]) < abs(fresh["path"][0]["effect"]) / 3


def test_contest_from_sponsor_lowers_denounce_weight():
    denounces = [
        rec("me", "carl", "denounce", "2026-10-30T00:00:00Z"),
        rec("b", "carl", "denounce", "2026-10-30T01:00:00Z"),
    ]
    before = ev(denounces, "carl")
    after = ev([*denounces, rec("a", "carl", "vouch"), rec("a", "carl", "contest")], "carl")
    assert before["decision"] == "FLAG"
    assert after["score"] > before["score"] and after["decision"] != "FLAG"
