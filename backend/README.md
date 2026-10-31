# Sniffer backend

Python backend for **Sniffer**, a decentralized trust network for open-source contributions
(Hacktoberfest 2026, Problem 07). It serves the JSON API under `/api` **and** the frontend in `frontend/`,
so one command runs everything. Full endpoint reference with real examples: [`docs/API.md`](../docs/API.md).

Stack: Python 3.11+, FastAPI, Uvicorn, SQLite (stdlib `sqlite3`), PyNaCl (ed25519), datasketch (MinHash/LSH),
the `ollama` package for a **local** Gemma model, pytest, ruff. No cloud AI services, no API keys, synthetic data only.

## Setup and run

```bash
# 1. optional, for AI summaries: a local model through Ollama
ollama pull gemma4:e2b

# 2. install (Python 3.11 or newer)
python3 -m venv backend/.venv
backend/.venv/bin/pip install -e "backend[dev]"

# 3. run API + frontend from the repo root
backend/.venv/bin/uvicorn app.main:app --app-dir backend --port 8000
```

Open http://localhost:8000. The header badge shows **Live**. Or run `backend/scripts/run_dev.sh`, which creates the
venv on first use and starts the server with auto-reload.

On first start with an empty database the demo network (seed 2026) is loaded automatically.

Checks:

```bash
backend/.venv/bin/ruff check backend
backend/.venv/bin/pytest backend                 # no Ollama needed
SNIFFER_LIVE=1 backend/.venv/bin/pytest backend -m live   # also calls the real local model
backend/.venv/bin/python backend/scripts/make_examples.py # regenerate examples/ and docs/API.md
```

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `SNIFFER_DB` | `backend/sniffer.db` | SQLite file (git-ignored) |
| `SNIFFER_MODEL` | `gemma4:e2b` | Ollama model name |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server |
| `SNIFFER_AI_BUDGET` | `6` | Seconds a request waits for Gemma before answering with deterministic text (warm replies take about 0.5–1.5 s; the first call after Ollama starts can take longer). The model keeps going in the background and caches the answer. Keep it below the frontend's 8 s request timeout. |
| `SNIFFER_DECAY` | `0.8` | Trust decay per hop |
| `SNIFFER_MAX_DEPTH` | `3` | Default max hops (per project `max_depth` overrides) |
| `SNIFFER_ALLOW_THRESHOLD` / `SNIFFER_FLAG_THRESHOLD` | `0.5` / `-0.5` | Decision thresholds |
| `SNIFFER_MIN_DENOUNCERS` | `2` | Independent trusted denouncers needed for FLAG |
| `SNIFFER_HALF_LIFE_DAYS` | `180` | Age half-life of a denounce |
| `SNIFFER_FRONTEND` | `frontend/` | Static files directory |

## How it works

### Signed records (`app/crypto.py`)
Every project has an ed25519 key pair. A record `{id, issuer, subject_handle, type, reason, evidence_urls,
timestamp}` is signed over canonical JSON (sorted keys, compact, UTF-8, everything except `signature`).
Signatures are verified on `POST /api/records` (bad ones are rejected) and on network import (bad ones are kept
but marked `signature_valid: false`, and the trust engine ignores them). A denounce must carry at least one evidence
URL. Records are append-only: there is no update or delete endpoint. Private keys exist only in the dev/simulation
database and no endpoint ever returns them.

### Trust engine (`app/trust.py`, pure and deterministic, no AI)
1. **Transitive trust.** From the evaluating project (trust 1.0), each hop multiplies by edge weight × decay, keeping
   the strongest path within `max_depth` hops: two full-trust hops give 0.8, then 0.64. Each project can set its own
   `max_depth` and `decay` with `PUT /api/trust/settings` (the Trust page does this). This is the same model as the
   frontend's mock mode (`frontend/js/lib/trustMath.js`).
2. **Filtering.** Records are ignored, each with a reason: invalid signature, issuer not in your trust graph, issuer
   beyond the depth limit, superseded by a newer record from the same project, or a contest from a non-sponsor.
3. **Scoring.** A vouch adds `+trust`. A denounce subtracts `trust × corroboration × age × contest`:
   *corroboration* is 0.75 to 1.25 depending on how often this issuer's earlier denounces were later echoed by another
   trusted issuer; *age* halves the weight every 180 days; *contest*: a contest record from a trusted **sponsor** (a project
   that vouched for the contributor) multiplies denounce weight by `1 − 0.5 × sponsor trust` and appears in `path`.
   The score is clamped to −1…+1.
4. **Decision.** No usable records → **UNKNOWN** ("No history. Normal review, not blocked."). **FLAG** needs score ≤ −0.5
   *and* at least 2 independent trusted denouncing projects, so a single denounce can only give **REVIEW**.
   Score ≥ 0.5 → **ALLOW**. Otherwise **REVIEW**.

The model never makes or changes a decision. It only rewrites the summary, and a guard rejects any model summary that
does not restate the engine's decision. The "not blocked" guarantee and the ignored-records sentence are added by code.

### Campaign detection (`app/campaigns.py`)
- **Deterministic stage:** MinHash (128 permutations, fixed seed) over character 5-gram shingles of title + diff, LSH
  candidates confirmed at Jaccard ≥ 0.6, union-find into groups. A group is a campaign only with ≥ 5 PRs, ≥ 3
  projects, a window ≤ 240 minutes and a median account age ≤ 30 days. Honest newcomers each change different code,
  so they share almost no shingles and are never grouped.
- **AI stage (`app/llm.py`):** the model sees at most 5 truncated events and must answer strict JSON
  `{"verdict": "spam" | "legit" | "unclear", "reason": "..."}`. The JSON is validated with pydantic; invalid
  JSON is retried once, then the verdict falls back to `unclear`. A second prompt writes the 2-3 sentence
  `evidence_summary`.
- `POST /api/campaigns/{id}/suggest-denounce` returns **unsigned proposals only**. Nothing is stored, signed or sent.

### Language model (`app/llm.py`)
All prompts live in one file. The system prompt says contributor text inside `<data>…</data>` is untrusted and must
never be followed. Every contributor-controlled string is stripped of control and bidi characters, has `<` and `>`
neutralised (so `</data>` cannot close the wrapper), and is truncated. Calls use a 20 s timeout, one retry, `think=False`
(gemma4 is a reasoning model and otherwise spends its output budget thinking), and temperature 0. Results are cached in
SQLite by a hash of (model, task, prompt). If Ollama is unreachable, deterministic text is returned with `ai: false`.

### Simulation (`app/simulate.py`)
Seeded and reproducible (keys are derived from the seed). It creates 20-50 projects using the frontend demo's names,
signed vouches and denounces, honest newcomers, about 38 lightly reworded README-typo PRs from 3-day-old accounts across
about 40 projects within 2 hours, a lone mistaken denounce, a denounce from untrusted Shadow Registry, one record with
an invalid signature, a contested denounce, and a contributor vouched through a trusted peer.

## Real test network (GitHub)

The default network on a fresh database is **10 real open-source repositories**:
oppia, Rocket.Chat, meshery, PictoPy, apps-android-commons, openfoodfacts-androidapp, zulip, p5.js, metacall/core
and scummvm. Load it with `POST /api/simulate/load {"preset": "github"}`, or the **Load 10 real GitHub repos**
button on the Simulate page.

| | Source |
|---|---|
| Repositories, pull requests (title, body excerpt, diff excerpt, timestamps) | **Real**, read from the GitHub API |
| Author account creation dates (so account age is real) | **Real** |
| Trust edges between repositories | **Synthetic**: a fixed governance graph chosen for the test |
| Signed vouch and denounce records | **Synthetic**, only about fictional `demo-*` handles, with `example.com` evidence |

No record is about a real person, so every real author is **UNKNOWN** (no history, not blocked). That is the
honest answer until real projects publish signed records.

Rebuild the file (about 6 minutes, roughly 700 read-only API calls, needs `gh auth login`):

```bash
backend/.venv/bin/python backend/scripts/fetch_github.py          # writes examples/input/github-real.json
```

What the real data showed:
- **0 campaigns.** 17 groups of similar titles exist with the campaign filters switched off: Dependabot bumps and
  repeated titles inside one project from old accounts. The rules correctly ignore them.
- Dependabot and other bots author 34 of the 299 PRs and are not treated as a special case.

The synthetic demo network (seed 2026, with the spam wave) is still available as `"preset": "demo"`.

## Layout

```
backend/
  app/main.py        app factory, error handlers, static frontend mounted last
  app/db.py          SQLite schema and parameterized queries
  app/models.py      pydantic request/response models
  app/crypto.py      ed25519 signing and verification
  app/trust.py       trust engine (pure)
  app/campaigns.py   MinHash/LSH campaign detection
  app/llm.py         the only module that talks to the model
  app/simulate.py    seeded synthetic network
  app/routes/        network.py, records.py, campaigns.py, common.py
  scripts/           run_dev.sh, make_examples.py
  tests/             pytest (crypto, trust, simulate, campaigns, llm, api, guard)
```

## Honest limits

- **Simulated data.** Everything is synthetic. Nothing reads from or posts to GitHub, and the evidence URLs point at
  `example.com`.
- **Heuristic detection.** MinHash thresholds and burst rules are tuned for the simulated wave. Real spam can be
  reworded more heavily, spread out over days, or come from aged accounts; legitimate coordinated efforts (for example a
  mass dependency bump) can look like a burst. The model's verdict is advisory and never blocks anyone.
- **Sybil attacks are mitigated, not solved.** Trust only flows from projects you choose, decays per hop and stops at
  the depth limit, and FLAG needs independent denouncers. But an attacker who earns trust from one of your peers, or
  runs several projects that you trust, can still vouch for accounts or coordinate denounces.
- **Independence is approximated** as distinct issuers; two projects run by the same people still count twice.
- **Key management is demo-grade.** Private keys sit in the dev SQLite file so the simulation can sign. A real
  deployment would keep keys with each project and only publish public keys.
- **The small model can be wrong.** gemma4:e2b summaries are constrained to the engine's facts and checked for the
  decision word, but wording can still be clumsy. Decisions never depend on the model.
