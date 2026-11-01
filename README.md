# Sniffer

**A trust network against AI slop, powered by Gemma running on your own laptop.**

Hacktoberfest 2026 Hack Day, Sonipat · Team **Byte Bandits** · Problem 7 (decentralized trust network) · MIT

Maintainers are flooded with low-effort, AI-generated pull requests. Sniffer lets each project label its own
contributors, share vouch and denounce records with the projects it trusts, and catch coordinated spam campaigns
early, with the evidence attached. Every AI judgement comes from `gemma4:e2b` running locally through Ollama.
No cloud AI, no API keys.

## The problem (Problem Statement 7)

> **A trust network against AI slop.** Projects share whom they vouch for, choose whom they trust, and catch spam
> campaigns early. Example: *38 near-identical PRs from 3-day-old accounts hit 40 projects in 2 hours. Flagged,
> with the evidence.*

Hacktoberfest-style events used to count contributions, and that led to spam. Today maintainers also face a
flood of AI-generated pull requests: typo fixes, badge additions and reworded templates from brand-new accounts.
Each maintainer reviews them alone, and nobody shares what they learned about a contributor. Coordinated
campaigns that hit many projects at once go unnoticed until the damage is done.

## Our solution

Sniffer is a **maintainer portal** where every project keeps its own judgement of contributors, backed by
evidence, and shares it with the projects it trusts.

1. **Load a project.** A maintainer adds a project (a zip with `project.json`, or a repository whose PRs are
   fetched from the public GitHub API).
2. **Gemma reads every PR.** `gemma4:e2b`, running locally, labels each PR *spam* or *genuine* with a one-line
   reason.
3. **Records follow from the labels.** Each contributor gets a vouch (genuine work) or a denounce (spam) record
   from that project, with evidence links and timestamps.
4. **Trust is shared.** Projects of the same maintainer trust each other, so a denounce from one project counts
   in another. The decision engine combines the records: **ALLOW**, **REVIEW**, **UNKNOWN** (new, never
   blocked) or **FLAG** (denounced by two or more trusted projects).
5. **Campaigns are caught.** Near-identical PRs from young accounts inside a short window are clustered
   (MinHash), Gemma reviews the cluster, and the radar replays the wave.
6. **The maintainer decides.** Sniffer shows spam weight, evidence and the verdict, but only the maintainer
   clicks **Block** or **Accept**.

## What it does

| Feature | How |
|---|---|
| **Maintainer portal** | Sign in with your GitHub username. Only listed maintainers of a project can open it. |
| **PR classification** | Gemma reads each PR's title, body and diff and returns `spam` or `genuine` with a one-line reason (strict JSON). |
| **Records** | Every contributor's PRs as PR1, PR2… each tagged spam / not spam, with reason, evidence link and timestamp. |
| **Spam weight** | The share of a contributor's classified PRs that are spam: 0% for trusted, 1–100% for spam accounts. |
| **Trust** | Contributors split into trusted and not trusted, with counts and spam weight. |
| **Evaluate** | ALLOW / REVIEW / UNKNOWN / FLAG for any handle, computed by `trust.py`. Gemma explains the decision in plain English. An unknown contributor is never blocked. |
| **Campaigns** | MinHash similarity + time window + account age find bursts of near-identical PRs. Gemma gives each cluster a verdict. A radar replay shows the PRs flying in and the campaign being flagged. |
| **Maintainer decides** | Sniffer never blocks anyone by itself. The maintainer chooses Block or Accept for each contributor. |

## Where Gemma does the work (Gemma track)

| Task | Code |
|---|---|
| Label every PR spam / genuine, with a reason | `backend/app/llm.py` → `classify_pr` |
| Verdict and summary for each detected campaign | `classify_cluster`, `summarize_campaign` |
| Summary of a contributor's public GitHub activity | `summarize_github` |
| Plain-English explanation of each trust decision | `summarize_decision` |

Deterministic code makes the final decisions (`backend/app/trust.py`, `backend/app/campaigns.py`), so the model
can never block someone on its own. The app uses the internet only for public GitHub data, never for AI.

## How it works

```
 project zip / GitHub repo
          │
          ▼
  ingest.py ── github.py (public REST, read-only)
          │   stores projects + PRs in SQLite (db.py)
          ▼
  jobs.py  background classification job
          │   for each PR ─► llm.py ─► Gemma (Ollama, localhost:11434)
          │                   strict JSON {spam, reason}, cached in SQLite
          ▼
  analysis.py
          ├─ derived records (vouch / denounce per project and contributor)
          ├─ spam weight, trust lists, graph series
          ├─ campaigns.py  MinHash/LSH + time window + account age ─► Gemma verdict
          └─ trust.py      ALLOW / REVIEW / UNKNOWN / FLAG (deterministic)
          │
          ▼
  routes/  FastAPI JSON API (/api/...) with session cookie + maintainer check
          │
          ▼
  frontend/  login → dashboard → project tabs (Overview, Graph, Evaluate, Campaigns, Records, Trust)
```

### Maintainer workflow

1. **Sign in** with a GitHub username and password. Sign-up checks that the GitHub account exists and is
   listed as a maintainer of a loaded project.
2. **Dashboard:** every project you maintain, with merged PRs, trust edges, vouchers, denounces, flagged
   accounts and campaigns.
3. **Open a project → Overview:** press **Classify**; Gemma labels the PRs with a live progress bar.
4. **Records:** search a handle, see PR1, PR2… with spam / not spam, reason, evidence and timestamp.
5. **Trust:** trusted contributors (0% spam) and not trusted (1–100% spam weight), with counts.
6. **Evaluate:** type a handle, get the decision, the score, Gemma's explanation and a GitHub profile check.
7. **Campaigns:** pick a time window and minimum cluster size; watch the radar replay and read Gemma's verdict.
8. **Decide:** Block or Accept a contributor. The choice is stored, and Sniffer never blocks on its own.

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| AI | **Gemma 4 (`gemma4:e2b`)** via **Ollama** | Open-weight, runs on a laptop, no keys; JSON mode for strict output |
| Backend | **Python 3.11+, FastAPI, Uvicorn, Pydantic** | Small typed JSON API, validation on every input |
| Storage | **SQLite** (standard library) | No server to run; parameterised queries only |
| Similarity | **datasketch** (MinHash + LSH) | Finds near-identical PRs fast and deterministically |
| GitHub | **httpx** + public GitHub REST API | Read-only PR and profile data; optional `GITHUB_TOKEN` from the environment, never stored |
| Auth | PBKDF2 password hashes, HttpOnly SameSite cookies | No third-party identity service |
| Frontend | **Plain HTML, CSS and ES modules**, Canvas and SVG | No build step, no framework, no CDN; text set with `textContent` only |
| Quality | **pytest, ruff, node --test, GitHub Actions** | Same checks locally and in CI, fully offline |

## Quick start

```bash
# 1. Gemma, locally
ollama pull gemma4:e2b
ollama serve                        # if it is not already running

# 2. Backend (also serves the frontend)
python3 -m venv backend/.venv
backend/.venv/bin/pip install -e "backend[dev]"

# 3. Load the example projects
backend/.venv/bin/python backend/scripts/load_project.py examples/input/d1-oppia.zip \
  --as <your-github-login> --id d1 --name "D1 (oppia)" --github oppia/oppia
backend/.venv/bin/python backend/scripts/load_project.py examples/input/synthetic-d2.zip --as <your-github-login>

# 4. Run, then open http://localhost:8000 and sign up with that GitHub login
backend/.venv/bin/uvicorn app.main:app --app-dir backend --port 8000
```

Open a project, press **Classify**, and watch Gemma label the PRs. Then open **Campaigns** to see the replay.

## Directory structure

```
Byte-Bandits/
├── README.md                     project overview (this file)
├── HACKATHON.md                  team, problem statement, models and why
├── LICENSE                       MIT
├── AGENTS.md                     rules for AI coding assistants working on this repo
├── .gitignore
├── .github/
│   ├── workflows/ci.yml          CI: ruff + pytest (backend) and node --test (frontend) on every PR
│   └── pull_request_template.md  every PR names its models and AI assistants
│
├── backend/                      FastAPI + SQLite + local Gemma
│   ├── pyproject.toml            dependencies and tool settings
│   ├── README.md                 backend details and API list
│   ├── app/
│   │   ├── main.py               app factory, /api/health, no-cache headers, serves frontend/
│   │   ├── llm.py                the only module that talks to a model: Gemma via Ollama, prompts, cache
│   │   ├── trust.py              decision engine: ALLOW / REVIEW / UNKNOWN / FLAG
│   │   ├── campaigns.py          MinHash/LSH campaign detection and denounce suggestions
│   │   ├── analysis.py           records, spam weight, trust lists, graph series, campaigns per project
│   │   ├── ingest.py             project zip upload, bundle split, GitHub PR fallback
│   │   ├── github.py             public GitHub REST client (users, merged PRs, diffs), cached
│   │   ├── jobs.py               background PR classification with progress
│   │   ├── auth.py               sign up / sign in, PBKDF2 hashes, sessions
│   │   ├── db.py                 SQLite schema and queries
│   │   ├── models.py             Pydantic request and model-output schemas
│   │   └── routes/
│   │       ├── auth.py           /api/auth/signup, login, logout, me
│   │       ├── projects.py       /api/projects/... (classify, graph, trust, records, evaluate,
│   │       │                     campaigns, decisions, events)
│   │       └── deps.py           shared dependencies: database, signed-in user, maintainer check
│   ├── scripts/
│   │   ├── load_project.py       load a project zip (or a bundle of projects) into the database
│   │   ├── make_test_project.py  build the synthetic D2 campaign fixture
│   │   ├── export_examples.py    write examples/output/ from the real app and Gemma
│   │   ├── create_demo_login.py  local demo login for presentations
│   │   └── run_dev.sh            start the server for development
│   └── tests/                    pytest: trust engine, LLM parsing, end-to-end API flow,
│                                 access guard, campaign fixture (fake LLM, mocked GitHub)
│
├── frontend/                     no build step: open via the backend at http://localhost:8000
│   ├── index.html                shell: top bar, Gemma status, tabs
│   ├── css/base.css              design tokens, light and dark themes, components
│   ├── js/
│   │   ├── app.js                hash router: #/login, #/dashboard, #/p/<id>/<tab>
│   │   ├── api.js                every backend call goes through here
│   │   ├── dom.js, ui.js, widgets.js   safe element builders, toasts, meters, decision buttons
│   │   ├── state.js, theme.js, sound.js, background.js   preferences, colours, sound, backdrop
│   │   ├── lib/                  campaignStats.js, decision.js, format.js (pure, unit-tested)
│   │   └── pages/                login, dashboard, project (overview), graph, evaluate, evalGraph,
│   │                             campaigns, campaignRadar, records, trust
│   └── tests/                    node --test: campaign stats, decisions, colour contrast, security rules
│
└── examples/
    ├── README.md                 what each input and output file shows
    ├── input/
    │   ├── d1-oppia.zip          real repository: oppia/oppia (project D1)
    │   └── synthetic-d2.zip      labelled test fixture: 13 spam accounts, 38 PRs in 107 min (project D2)
    └── output/                   real API responses produced with gemma4:e2b
        ├── health.json           model in use and Ollama status
        ├── dashboard.json, d1-overview.json, d2-overview.json
        ├── d2-campaigns.json     the detected campaign with Gemma's verdict
        ├── d1-trust.json, d2-trust.json
        ├── d2-records-test-spam-07.json
        ├── d2-evaluate-*.json    spam 100%, spam 5%, genuine, unknown
        └── d2-graph.json
```

## Tests and evidence

```bash
backend/.venv/bin/ruff check backend
backend/.venv/bin/pytest backend
node --test frontend/tests/*.test.js
```

CI runs the same three on every PR. The tests replace Gemma with a fixed fake and mock GitHub, so they need no
network and no keys. Real Gemma output is in [`examples/output/`](examples/output/); see
[`examples/README.md`](examples/README.md).

## Development history (pull requests)

Every change after the first commit went through a pull request that names its models.

| PR | What changed |
|---|---|
| [#1](https://github.com/Arin-J26/Byte-Bandits/pull/1) | First frontend: trust command center UI |
| [#2](https://github.com/Arin-J26/Byte-Bandits/pull/2) | Ignore `CLAUDE.md` (replaced by the root `.gitignore` in #6) |
| [#3](https://github.com/Arin-J26/Byte-Bandits/pull/3) | Backend: trust engine, campaign detection, local Gemma |
| [#4](https://github.com/Arin-J26/Byte-Bandits/pull/4) | Live-mode fixes: no silent mock fallback, Gemma status, UI bugs |
| [#5](https://github.com/Arin-J26/Byte-Bandits/pull/5) | Real GitHub repositories as the test network |
| [#6](https://github.com/Arin-J26/Byte-Bandits/pull/6) | CI workflow, PR template, root `.gitignore` |
| [#7](https://github.com/Arin-J26/Byte-Bandits/pull/7) | Redesign as a maintainer portal: login, dashboard, project tabs, Gemma PR classification, spam weight, Block / Accept |
| [#8](https://github.com/Arin-J26/Byte-Bandits/pull/8) | Campaign test fixture and real example outputs |
| [#9](https://github.com/Arin-J26/Byte-Bandits/pull/9) | README and the correct model in `HACKATHON.md` |
| [#10](https://github.com/Arin-J26/Byte-Bandits/pull/10) | This guide: problem, solution, workflow, tech stack, directory structure, history |

## Models and tools

- **Product:** `gemma4:e2b`, open-weight, run locally with Ollama. This is the only model the code calls.
- **Development:** Claude Code helped write code. It is not part of the product, and each PR names it.

## License

[MIT](LICENSE)
