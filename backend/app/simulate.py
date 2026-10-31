"""Seeded, reproducible synthetic network.

The core story uses the same names as the frontend demo (perspective `lumen-ui`):
- @ada-commits: vouched by Nebula DB (1 hop) and quasar-cli (2 hops) -> ALLOW. Shadow Registry,
  which nobody trusts, denounces her (ignored: not in your trust graph); zenith-web (4 hops) vouches
  (ignored: beyond depth limit).
- @borderline-ben: vouched only by PyForge (0.8 x 0.8 = 0.64) -> ALLOW; lowering trust in PyForge
  flips it to REVIEW.
- @newbie-nora and other honest newcomers: one distinct PR each, no records -> UNKNOWN.
- @solo-denounce-sam: one mistaken/malicious lone denounce -> REVIEW only.
- @ivan-invalid: a vouch whose signature does not verify -> ignored.
- @contested-carl: denounced twice, contested by a sponsor that vouched for him.
- A coordinated spam wave: ~38 near-identical, lightly reworded README typo PRs from 3-day-old
  accounts across ~40 projects within 2 hours; the accounts are denounced by two trusted projects -> FLAG.
"""

from __future__ import annotations

import hashlib
import random
from datetime import UTC, datetime, timedelta

from .crypto import generate_keypair, sign_record, verify_record

ANCHOR = datetime(2026, 10, 31, 12, 0, tzinfo=UTC)
ME = "lumen-ui"

CORE = [
    ("lumen-ui", "Lumen UI"),
    ("nebula-db", "Nebula DB"),
    ("pyforge", "PyForge"),
    ("quasar-cli", "quasar-cli"),
    ("orbit-ml", "orbit-ml"),
    ("helix-auth", "helix-auth"),
    ("zenith-web", "zenith-web"),
    ("shadow-registry", "Shadow Registry"),
    ("aurora-docs", "aurora-docs"),
    ("mosaic-css", "mosaic-css"),
    ("kepler-maps", "kepler-maps"),
    ("prism-lint", "prism-lint"),
    ("tidal-sched", "tidal-sched"),
]
CORE_EDGES = [
    ("lumen-ui", "nebula-db", 1.0),
    ("lumen-ui", "pyforge", 0.8),
    ("lumen-ui", "aurora-docs", 0.6),
    ("nebula-db", "quasar-cli", 1.0),
    ("pyforge", "orbit-ml", 0.9),
    ("aurora-docs", "mosaic-css", 0.7),
    ("quasar-cli", "helix-auth", 1.0),
    ("orbit-ml", "kepler-maps", 0.8),
    ("helix-auth", "zenith-web", 1.0),
    ("zenith-web", "tidal-sched", 0.7),
    ("mosaic-css", "prism-lint", 0.6),
]
WORDS = [
    "cobalt",
    "drift",
    "ember",
    "fable",
    "granite",
    "harbor",
    "ion",
    "jade",
    "lattice",
    "nova",
    "opal",
    "rune",
    "vega",
    "willow",
    "xenon",
    "yarrow",
    "zephyr",
    "atlas",
    "birch",
    "cinder",
    "dune",
    "fjord",
    "glacier",
    "haze",
    "iris",
    "juniper",
    "krypton",
    "lumen",
    "meadow",
    "nectar",
    "onyx",
    "pebble",
]
KINDS = [
    "router",
    "sync",
    "cache",
    "lang",
    "fs",
    "ci",
    "stream",
    "tests",
    "crypto",
    "queue",
    "logs",
    "shell",
    "http",
    "orm",
    "charts",
    "auth",
    "kit",
    "db",
    "ui",
    "cli",
]
SPAM_TITLES = [
    "Fix typo in README.md",
    "fix typo in readme",
    "Fixed a typo in README",
    "Update README.md (typo fix)",
    "docs: fix typo in README",
]
SPAM_PREFIXES = ["quickfix", "typo-hunter", "readme-rex", "docbot", "pr-farm", "tweak-tom", "gh-user", "fresh-acct"]
VOCAB = (
    "parser cache buffer index token stream socket thread worker queue schema migration render layout widget "
    "router handler session cookie header payload encoder decoder tensor matrix vector kernel shader texture "
    "palette gradient font locale timezone calendar invoice ledger account wallet ticket backlog sprint "
    "benchmark profiler allocator iterator closure promise future channel mutex semaphore barrier"
).split()


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _spam_diff(project: str, r: random.Random) -> str:
    fast = r.choice(["fast", "quick", "speedy"])
    lib = r.choice(["library", "toolkit", "package"])
    easy = r.choice(["easy", "simple", "straightforward"])
    return (
        "--- a/README.md\n+++ b/README.md\n@@ -1,8 +1,8 @@\n"
        f" # {project}\n"
        f"-Teh {fast} and lightweight {lib} for modern developers.\n"
        f"+The {fast} and lightweight {lib} for modern developers.\n"
        f" It is {easy} to install, configure and extend with plugins.\n"
        " ## Getting started\n Run the installer and follow the prompts in your terminal.\n"
        " Contributions are welcome, please read CONTRIBUTING.md first.\n"
    )


def _unique_diff(r: random.Random, title: str) -> str:
    """A distinct change: random file, random identifiers and prose, so honest PRs never look alike."""
    words = lambda n: " ".join(r.choice(VOCAB) for _ in range(n))  # noqa: E731
    fname = f"src/{r.choice(VOCAB)}_{r.choice(VOCAB)}.py"
    fn = f"{r.choice(VOCAB)}_{r.choice(VOCAB)}_{r.randint(1, 999)}"
    return (
        f"--- a/{fname}\n+++ b/{fname}\n@@ -{r.randint(1, 300)},6 +{r.randint(1, 300)},9 @@\n"
        f"+def {fn}({r.choice(VOCAB)}, {r.choice(VOCAB)}=None):\n"
        f'+    """{title}: {words(8)}."""\n'
        f"+    {r.choice(VOCAB)} = {r.choice(VOCAB)}.{r.choice(VOCAB)}({r.randint(0, 99)})\n"
        f"+    return {r.choice(VOCAB)}  # {words(6)}\n"
        f" # {words(10)}\n"
    )


def generate_network(projects: int = 40, newcomers: int = 8, campaign_size: int = 38, seed: int = 2026) -> dict:
    r = random.Random(seed)
    n = max(len(CORE), min(50, projects))

    # ----- projects (keys derived from the seed: reproducible) -----
    plist = list(CORE)
    used = {p for p, _ in plist}
    while len(plist) < n:
        pid = f"{r.choice(WORDS)}-{r.choice(KINDS)}"
        if pid not in used:
            used.add(pid)
            plist.append((pid, pid))
    keys = {pid: generate_keypair(hashlib.sha256(f"{seed}:{pid}".encode()).digest()) for pid, _ in plist}
    project_rows = [
        {"id": pid, "name": name, "public_key": keys[pid][1], "private_key": keys[pid][0], "max_depth": 3}
        for pid, name in plist
    ]
    generated = [pid for pid, _ in plist[len(CORE) :]]

    # ----- trust edges: curated core, generated projects only trust each other or point into the core -----
    edges = {(a, b): w for a, b, w in CORE_EDGES}
    for g in ["shadow-registry", *generated]:
        for _ in range(r.randint(1, 3)):
            target = r.choice(generated + [c for c, _ in CORE if c not in ("shadow-registry",)])
            if target != g and target != "shadow-registry":
                edges[(g, target)] = round(r.uniform(0.4, 1.0), 1)
    trust_edges = [{"from": a, "to": b, "weight": w} for (a, b), w in edges.items()]

    # ----- records -----
    records: list[dict] = []

    def add(issuer, handle, type_, reason, when, evidence=None, tamper=False):
        rec = {
            "id": f"rec-{len(records) + 1:04d}",
            "issuer": issuer,
            "subject_handle": handle,
            "type": type_,
            "reason": reason,
            "evidence_urls": evidence or [],
            "timestamp": _iso(when),
        }
        rec["signature"] = sign_record(rec, keys[issuer][0])
        if tamper:
            rec["reason"] += " (edited after signing)"
        rec["signature_valid"] = verify_record(rec, keys[issuer][1])
        records.append(rec)

    ev = lambda p, k: [f"https://example.com/{p}/pull/{k}"]  # noqa: E731
    day = timedelta(days=1)
    add(
        "nebula-db",
        "ada-commits",
        "vouch",
        "14 merged PRs over 6 months, all with tests",
        ANCHOR - 40 * day,
        ev("nebula-db", 412),
    )
    add(
        "quasar-cli",
        "ada-commits",
        "vouch",
        "Fixed a tricky race in the plugin loader",
        ANCHOR - 30 * day,
        ev("quasar-cli", 88),
    )
    add(
        "shadow-registry",
        "ada-commits",
        "denounce",
        "Disagreed with our maintainers in review",
        ANCHOR - 9 * day,
        ev("shadow-registry", 7),
    )
    add("zenith-web", "ada-commits", "vouch", "Good docs contributions", ANCHOR - 20 * day, ev("zenith-web", 31))
    add("pyforge", "borderline-ben", "vouch", "Two solid merged PRs", ANCHOR - 15 * day, ev("pyforge", 1201))
    add(
        "aurora-docs",
        "solo-denounce-sam",
        "denounce",
        "Rude comment in one issue thread",
        ANCHOR - 12 * day,
        ev("aurora-docs", 64),
    )
    add("nebula-db", "ivan-invalid", "vouch", "Claims to be a long-time contributor", ANCHOR - 8 * day, tamper=True)
    add(
        "aurora-docs",
        "contested-carl",
        "denounce",
        "Pushed a broken release script",
        ANCHOR - 20 * day,
        ev("aurora-docs", 70),
    )
    add(
        "orbit-ml",
        "contested-carl",
        "denounce",
        "Same broken script submitted here",
        ANCHOR - 19 * day,
        ev("orbit-ml", 140),
    )
    add(
        "nebula-db",
        "contested-carl",
        "vouch",
        "Long-time maintainer of our CLI",
        ANCHOR - 60 * day,
        ev("nebula-db", 300),
    )
    add(
        "nebula-db",
        "contested-carl",
        "contest",
        "The script bug was ours; Carl reported and fixed it",
        ANCHOR - 18 * day,
        ev("nebula-db", 301),
    )
    # background history across the generated network
    for g in generated:
        for _ in range(r.randint(1, 3)):
            add(
                g,
                f"dev-{r.randint(1000, 9999)}",
                "vouch",
                r.choice(
                    [
                        "Several merged PRs with tests",
                        "Helpful reviewer",
                        "Fixed a memory leak",
                        "Great documentation work",
                    ]
                ),
                ANCHOR - r.randint(5, 200) * day,
            )

    # ----- PR events -----
    pr_events: list[dict] = []

    def pr(handle, project, age, title, body, diff, when):
        pr_events.append(
            {
                "id": f"pr-{len(pr_events) + 1:04d}",
                "project_id": project,
                "handle": handle,
                "account_age_days": age,
                "title": title,
                "body_excerpt": body,
                "diff_text": diff,
                "created_at": _iso(when),
            }
        )

    wave_start = ANCHOR - timedelta(hours=3)
    accounts = max(2, -(-campaign_size // 3)) if campaign_size else 0
    spam_handles = ["spam-bot-7731"] + [f"{r.choice(SPAM_PREFIXES)}-{r.randint(10, 9999)}" for _ in range(accounts - 1)]
    spam_handles = list(dict.fromkeys(spam_handles))
    targets = [pid for pid, _ in plist if pid != "shadow-registry"]
    r.shuffle(targets)
    for i in range(campaign_size):
        project = targets[i % len(targets)]
        when = wave_start + timedelta(minutes=i * (110 / max(1, campaign_size)) + r.uniform(0, 1.5))
        pr(
            spam_handles[i % len(spam_handles)],
            project,
            3,
            r.choice(SPAM_TITLES),
            "Small fix to improve the documentation.",
            _spam_diff(project, r),
            when,
        )
    for h in spam_handles:  # two trusted projects denounce every spam account (pyforge echoes nebula-db)
        add(
            "nebula-db",
            h,
            "denounce",
            "Templated README typo PR, part of a burst",
            wave_start + timedelta(hours=2, minutes=20),
            ev("nebula-db", r.randint(900, 999)),
        )
        add(
            "pyforge",
            h,
            "denounce",
            "Same templated PR opened across many projects",
            wave_start + timedelta(hours=2, minutes=40),
            ev("pyforge", r.randint(1300, 1399)),
        )
    if spam_handles:
        add(
            "orbit-ml",
            "spam-bot-7731",
            "denounce",
            "Bot-like burst of identical PRs",
            wave_start + timedelta(hours=2, minutes=50),
            ev("orbit-ml", 77),
        )

    newcomer_titles = [
        "Add dark-mode toggle to settings",
        "Improve error message for missing config",
        "Add unit tests for date parser",
        "Fix off-by-one in pagination",
        "Translate onboarding guide to Hindi",
        "Support YAML config files",
        "Speed up startup by lazy-loading plugins",
        "Add example for custom themes",
        "Handle empty input in CLI",
        "Document the release process",
    ]
    nc_names = ["newbie-nora"] + [f"newcomer-{w}" for w in r.sample(WORDS, k=min(len(WORDS), max(0, newcomers - 1)))]
    for i, h in enumerate(nc_names[:newcomers]):
        title = newcomer_titles[i % len(newcomer_titles)]
        pr(
            h,
            r.choice(targets),
            r.randint(1, 14),
            title,
            f"First contribution: {title.lower()}.",
            _unique_diff(r, title),
            wave_start + timedelta(minutes=r.uniform(0, 120)),
        )
    for h, p in [
        ("ada-commits", "nebula-db"),
        ("borderline-ben", ME),
        ("solo-denounce-sam", ME),
        ("contested-carl", "quasar-cli"),
    ]:
        title = r.choice(newcomer_titles)
        pr(
            h,
            p,
            r.randint(300, 2000),
            title,
            "Routine improvement.",
            _unique_diff(r, title),
            ANCHOR - timedelta(hours=r.uniform(4, 48)),
        )

    return {
        "projects": project_rows,
        "trust_edges": trust_edges,
        "records": records,
        "pr_events": sorted(pr_events, key=lambda e: e["created_at"]),
        "spam_handles": spam_handles,
    }
