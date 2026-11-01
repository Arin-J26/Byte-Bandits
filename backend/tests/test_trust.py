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
    weighted, _ = compute_trust(
        [{"from": "me", "to": "a", "weight": 0.8}, {"from": "a", "to": "b", "weight": 0.8}], "me", decay=1
    )
    assert weighted["b"].trust == pytest.approx(0.64)


def test_strongest_path_wins_and_via_lists_the_chain():
    edges = [*CHAIN, {"from": "me", "to": "b", "weight": 0.1}]
    res = ev([rec("b", "ada")], "ada", edges=edges)
    assert res["path"][0]["via"] == ["me", "a", "b"]
    assert res["path"][0]["weight"] == 0.64


def test_depth_cutoff():
    edges = [*CHAIN, {"from": "b", "to": "c", "weight": 1.0}]
    res = ev([rec("c", "ada")], "ada", edges=edges, max_depth=2)
    assert res["decision"] == "UNKNOWN"
    assert res["ignored"][0]["reason"] == "beyond depth limit (2 hops)"


def test_untrusted_issuer_ignored():
    res = ev([rec("a", "ada"), rec("stranger", "ada", "denounce")], "ada")
    assert res["decision"] == "ALLOW"
    assert {"reason": "not in your trust graph"}.items() <= res["ignored"][0].items()


def test_invalid_signature_ignored():
    res = ev([rec("a", "ada", valid=False)], "ada")
    assert res["decision"] == "UNKNOWN"
    assert res["ignored"][0]["reason"] == "invalid signature"


def test_no_records_is_unknown_not_blocked():
    res = ev([], "newbie")
    assert res["decision"] == "UNKNOWN"
    assert res["score"] == 0
    assert "Normal review, not blocked" in res["summary"]


def test_one_denounce_alone_is_review_not_flag_even_from_self():
    res = ev([rec("me", "sam", "denounce")], "sam")
    assert res["score"] <= -0.5
    assert res["decision"] == "REVIEW"
    assert "soft signal" in res["summary"]


def test_two_independent_trusted_denounces_flag():
    res = ev(
        [rec("me", "spam", "denounce", "2026-10-30T00:00:00Z"), rec("a", "spam", "denounce", "2026-10-30T01:00:00Z")],
        "spam",
    )
    assert res["decision"] == "FLAG"


def test_denounce_weight_decays_with_age():
    fresh = ev([rec("a", "x", "denounce", "2026-10-31T00:00:00Z")], "x")
    old = ev([rec("a", "x", "denounce", "2025-11-01T00:00:00Z")], "x")  # about two half-lives
    assert abs(old["path"][0]["effect"]) < abs(fresh["path"][0]["effect"]) / 3
    half = ev([rec("a", "x", "denounce", "2026-05-05T00:00:00Z")], "x", half_life_days=180)
    assert abs(half["path"][0]["effect"]) == pytest.approx(abs(fresh["path"][0]["effect"]) / 2, abs=0.02)


def test_corroborated_denouncer_weighs_more():
    lone = ev([rec("a", "x", "denounce", "2026-10-30T00:00:00Z")], "x")
    corroborated = ev(
        [rec("a", "x", "denounce", "2026-10-30T00:00:00Z"), rec("me", "x", "denounce", "2026-10-30T05:00:00Z")], "x"
    )
    a_lone = next(p for p in lone["path"] if p["project"] == "a")["effect"]
    a_corr = next(p for p in corroborated["path"] if p["project"] == "a")["effect"]
    assert abs(a_corr) > abs(a_lone)


def test_contest_from_sponsor_lowers_denounce_weight_and_shows_in_path():
    denounces = [
        rec("me", "carl", "denounce", "2026-10-30T00:00:00Z"),
        rec("b", "carl", "denounce", "2026-10-30T01:00:00Z"),
    ]
    before = ev(denounces, "carl")
    after = ev([*denounces, rec("a", "carl", "vouch"), rec("a", "carl", "contest")], "carl")
    assert before["decision"] == "FLAG"
    assert after["score"] > before["score"]
    assert after["decision"] != "FLAG"
    contest = next(p for p in after["path"] if p["type"] == "contest")
    assert contest["effect"] > 0 and contest["via"] == ["me", "a"]


def test_contest_from_non_sponsor_is_ignored():
    res = ev([rec("me", "carl", "denounce"), rec("a", "carl", "contest")], "carl")
    assert any("vouched" in i["reason"] for i in res["ignored"])
    assert not any(p["type"] == "contest" for p in res["path"])


def test_handles_are_case_and_at_insensitive():
    assert ev([rec("a", "Ada")], "@ADA")["decision"] == "ALLOW"


def test_evaluation_is_deterministic():
    recs = [rec("a", "z"), rec("b", "z", "denounce")]
    assert ev(recs, "z") == ev(recs, "z")
