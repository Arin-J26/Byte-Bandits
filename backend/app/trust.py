"""Trust engine. Pure and deterministic: no AI, no I/O.

Model (kept identical to frontend/js/lib/trustMath.js so live and mock mode agree):
- The evaluating project has trust 1.0 (hop 0). Each hop multiplies by edge weight x decay, so two
  full-trust hops with decay 0.8 give 0.8 then 0.64. Projects beyond max_depth are ignored.
- A vouch adds +trust. A denounce subtracts trust x corroboration x age decay x contest factor:
  * corroboration: issuers whose earlier denounces were later echoed by another trusted issuer
    weigh more (0.75 .. 1.25);
  * age: exponential decay with a configurable half-life (default 180 days);
  * contest: a contest record from a trusted sponsor (a project that vouched for the subject)
    shrinks denounce weight by contest_factor x sponsor trust.
- Score is clamped to [-1, 1] (the frontend gauge shows -1 .. +1).
- FLAG needs score <= flag_threshold AND >= min_denouncers independent trusted denounce issuers.
  A single denounce can only produce REVIEW. No usable records: UNKNOWN (never blocked).
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime


@dataclass(frozen=True)
class TrustConfig:
    decay: float = 0.8
    max_depth: int = 3
    allow_threshold: float = 0.5
    flag_threshold: float = -0.5
    min_denouncers: int = 2
    half_life_days: float = 180.0
    contest_factor: float = 0.5
    corroboration_min: float = 0.75
    corroboration_max: float = 1.25


@dataclass(frozen=True)
class Reach:
    trust: float
    hops: int
    path: tuple[str, ...]


def norm_handle(h: str) -> str:
    return str(h or "").strip().lstrip("@").lower()


def parse_ts(ts: str) -> datetime:
    dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def compute_trust(
    edges: list[dict], origin: str, decay: float = 0.8, max_depth: int = 3
) -> tuple[dict[str, Reach], set[str]]:
    """Strongest path to each project within max_depth hops, plus the set reachable only beyond it."""
    out: dict[str, list[tuple[str, float]]] = {}
    for e in edges:
        w = min(1.0, max(0.0, float(e["weight"])))
        if w > 0 and e["from"] != e["to"]:
            out.setdefault(e["from"], []).append((e["to"], w))
    best: dict[str, Reach] = {origin: Reach(1.0, 0, (origin,))}
    # Bounded Bellman-Ford: after round d, best holds the strongest path using <= d hops.
    for _ in range(max_depth):
        nxt = dict(best)
        for u, info in best.items():
            for v, w in out.get(u, []):
                if v in info.path:
                    continue
                t = info.trust * w * decay
                cur = nxt.get(v)
                if cur is None or t > cur.trust + 1e-12:
                    nxt[v] = Reach(t, info.hops + 1, (*info.path, v))
        best = nxt
    seen, queue = {origin}, deque([origin])
    while queue:
        u = queue.popleft()
        for v, _ in out.get(u, []):
            if v not in seen:
                seen.add(v)
                queue.append(v)
    return best, seen - best.keys()


def _corroboration(issuer: str, denounces: list[dict], trusted: set[str], cfg: TrustConfig) -> float:
    """Share of this issuer's denounces later echoed by a different trusted issuer, mapped to a weight."""
    own = [d for d in denounces if d["issuer"] == issuer]
    if not own:
        return 1.0
    hits = 0
    for d in own:
        t0 = parse_ts(d["timestamp"])
        if any(
            o["issuer"] != issuer
            and o["issuer"] in trusted
            and norm_handle(o["subject_handle"]) == norm_handle(d["subject_handle"])
            and parse_ts(o["timestamp"]) > t0
            for o in denounces
        ):
            hits += 1
    return cfg.corroboration_min + (cfg.corroboration_max - cfg.corroboration_min) * hits / len(own)


def _latest_per_issuer(records: list[dict]) -> tuple[list[dict], list[dict]]:
    by: dict[str, dict] = {}
    superseded = []
    for r in records:
        prev = by.get(r["issuer"])
        if prev is None:
            by[r["issuer"]] = r
        elif parse_ts(r["timestamp"]) > parse_ts(prev["timestamp"]):
            superseded.append(prev)
            by[r["issuer"]] = r
        else:
            superseded.append(r)
    return list(by.values()), superseded


def evaluate(
    edges: list[dict],
    records: list[dict],
    project_id: str,
    handle: str,
    cfg: TrustConfig | None = None,
    now: datetime | None = None,
) -> dict:
    """Return {decision, score, summary, path, ignored} for `handle` from `project_id`'s perspective."""
    cfg = cfg or TrustConfig()
    now = now or datetime.now(UTC)
    trust, beyond = compute_trust(edges, project_id, cfg.decay, cfg.max_depth)
    h = norm_handle(handle)
    valid = [r for r in records if r.get("signature_valid", True)]
    relevant = [r for r in records if norm_handle(r["subject_handle"]) == h]

    ignored: list[dict] = []
    usable: list[dict] = []
    for r in relevant:
        if not r.get("signature_valid", True):
            ignored.append({"record_id": r["id"], "reason": "invalid signature"})
        elif r["issuer"] not in trust:
            reason = (
                f"beyond depth limit ({cfg.max_depth} hops)" if r["issuer"] in beyond else "not in your trust graph"
            )
            ignored.append({"record_id": r["id"], "reason": reason})
        else:
            usable.append(r)

    opinions, superseded = _latest_per_issuer([r for r in usable if r["type"] in ("vouch", "denounce")])
    contests, old_contests = _latest_per_issuer([r for r in usable if r["type"] == "contest"])
    for r in superseded + old_contests:
        ignored.append({"record_id": r["id"], "reason": "superseded by a newer record from the same project"})

    sponsors = {r["issuer"] for r in usable if r["type"] == "vouch"}
    contest_mult = 1.0
    contest_items = []
    for c in contests:
        if c["issuer"] not in sponsors:
            ignored.append(
                {"record_id": c["id"], "reason": "contest only counts from a project that vouched for this contributor"}
            )
            continue
        t = trust[c["issuer"]].trust
        contest_mult *= 1 - cfg.contest_factor * t
        contest_items.append((c, t))

    all_denounces = [r for r in valid if r["type"] == "denounce"]
    trusted = set(trust)
    path: list[dict] = []
    vouchers: set[str] = set()
    denouncers: set[str] = set()
    raw = 0.0
    denounce_weight_before_contest = 0.0
    for r in opinions:
        reach = trust[r["issuer"]]
        if r["type"] == "vouch":
            effect = reach.trust
            vouchers.add(r["issuer"])
        else:
            age_days = max(0.0, (now - parse_ts(r["timestamp"])).total_seconds() / 86400)
            base = (
                reach.trust
                * _corroboration(r["issuer"], all_denounces, trusted, cfg)
                * 0.5 ** (age_days / cfg.half_life_days)
            )
            denounce_weight_before_contest += base
            effect = -base * contest_mult
            denouncers.add(r["issuer"])
        raw += effect
        path.append(
            {
                "project": r["issuer"],
                "via": list(reach.path),
                "weight": round(reach.trust, 2),
                "record_id": r["id"],
                "effect": round(effect, 2),
                "type": r["type"],
            }
        )
    for c, t in contest_items:
        path.append(
            {
                "project": c["issuer"],
                "via": list(trust[c["issuer"]].path),
                "weight": round(t, 2),
                "record_id": c["id"],
                # Positive: the denounce weight this contest removed.
                "effect": round(denounce_weight_before_contest * cfg.contest_factor * t, 2),
                "type": "contest",
            }
        )
    path.sort(key=lambda p: (-abs(p["effect"]), p["project"]))

    score = round(min(1.0, max(-1.0, raw)), 2)
    if not opinions:
        decision = "UNKNOWN"
    elif score <= cfg.flag_threshold and len(denouncers) >= cfg.min_denouncers:
        decision = "FLAG"
    elif score >= cfg.allow_threshold:
        decision = "ALLOW"
    else:
        decision = "REVIEW"

    return {
        "decision": decision,
        "score": score,
        "summary": template_summary(decision, h, vouchers, denouncers, len(ignored), bool(contest_items), cfg),
        "path": path,
        "ignored": ignored,
    }


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def template_summary(
    decision: str, handle: str, vouchers: set, denouncers: set, n_ignored: int, contested: bool, cfg: TrustConfig
) -> str:
    """Deterministic plain-language summary (used when the model is unavailable)."""
    ign = f" {_plural(n_ignored, 'record')} ignored." if n_ignored else ""
    con = " A trusted sponsor contested the denounces, which lowers their weight." if contested else ""
    if decision == "UNKNOWN":
        return f"No history. Normal review, not blocked.{ign}"
    if decision == "FLAG":
        who = _plural(len(denouncers), "independent trusted project")
        return f"@{handle} was denounced by {who}. Flagged for maintainer attention.{con}{ign}"
    if decision == "ALLOW":
        extra = f" (outweighing {_plural(len(denouncers), 'denounce')})" if denouncers else ""
        return f"@{handle} is vouched for by {_plural(len(vouchers), 'trusted project')}{extra}.{con}{ign}"
    if len(denouncers) == 1 and not vouchers:
        return (
            f"@{handle} has a single denounce. One denounce is a soft signal, so this is REVIEW, not FLAG "
            f"(FLAG needs {cfg.min_denouncers} independent projects).{con}{ign}"
        )
    return (
        f"Mixed or weak signals for @{handle}: {_plural(len(vouchers), 'vouch')}, "
        f"{_plural(len(denouncers), 'denounce')}. "
        f"A maintainer should take a normal look.{con}{ign}"
    )
