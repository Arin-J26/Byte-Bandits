import pytest

from app.campaigns import detect, suggest_denounces
from app.simulate import generate_network


@pytest.fixture(scope="module")
def net():
    return generate_network(projects=40, newcomers=30, campaign_size=38, seed=2026)


def test_simulated_wave_forms_one_cluster(net):
    clusters = detect(net["pr_events"])
    assert len(clusters) == 1
    c = clusters[0]
    assert len(c["pr_events"]) == 38
    assert set(c["handles"]) == set(net["spam_handles"])
    assert c["accounts_min_age_days"] == 3
    assert c["projects_hit"] >= 30
    assert c["window_minutes"] <= 120
    assert set(c) >= {
        "id",
        "size",
        "accounts_min_age_days",
        "projects_hit",
        "window_minutes",
        "similarity_method",
        "pr_events",
        "handles",
    }


def test_honest_newcomers_are_not_clustered(net):
    clustered = {e["handle"] for c in detect(net["pr_events"]) for e in c["pr_events"]}
    newcomers = {e["handle"] for e in net["pr_events"] if e["handle"].startswith(("newbie", "newcomer"))}
    assert len(newcomers) == 30
    assert not clustered & newcomers


def test_no_campaign_means_no_clusters():
    assert detect(generate_network(campaign_size=0, newcomers=20, seed=3)["pr_events"]) == []


def test_slow_or_established_duplicates_are_not_a_campaign(net):
    spam = [e for e in net["pr_events"] if e["account_age_days"] == 3]
    old = [dict(e, account_age_days=900) for e in spam]
    assert detect(old) == []
    spread = [dict(e, created_at=f"2026-{(i % 9) + 1:02d}-01T00:00:00Z") for i, e in enumerate(spam)]
    assert detect(spread) == []


def test_cluster_ids_are_deterministic(net):
    assert detect(net["pr_events"])[0]["id"] == detect(list(reversed(net["pr_events"])))[0]["id"]


def test_suggestions_are_unsigned_proposals(net):
    c = detect(net["pr_events"])[0]
    props = suggest_denounces(c, "lumen-ui")
    assert len(props) == c["size"]
    assert all(p["type"] == "denounce" and p["signed"] is False and p["evidence_urls"] for p in props)
    assert all("signature" not in p for p in props)
