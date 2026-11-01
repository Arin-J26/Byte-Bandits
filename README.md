# Sniffer

**A trust network against AI slop, powered by Gemma running on your own laptop.**

Hacktoberfest 2026 Hack Day, Sonipat · Team **Byte Bandits** · Problem 7 (decentralized trust network) · MIT

Maintainers are flooded with low-effort, AI-generated pull requests. Sniffer lets each project label its own
contributors, share vouch and denounce records with the projects it trusts, and catch coordinated spam campaigns
early, with the evidence attached. Every AI judgement comes from `gemma4:e2b` running locally through Ollama.
No cloud AI, no API keys.

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

## Where Gemma does the work

| Task | Code |
|---|---|
| Label every PR spam / genuine, with a reason | `backend/app/llm.py` → `classify_pr` |
| Verdict and summary for each detected campaign | `classify_cluster`, `summarize_campaign` |
| Summary of a contributor's public GitHub activity | `summarize_github` |
| Plain-English explanation of each trust decision | `summarize_decision` |

Deterministic code makes the final decisions (`backend/app/trust.py`, `backend/app/campaigns.py`), so the model
can never block someone on its own. The app uses the internet only for public GitHub data, never for AI.

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

## Repository layout

```
.
├── HACKATHON.md                 team, problem, models and why
├── LICENSE                      MIT
├── README.md                    this file
├── AGENTS.md                    rules for AI coding assistants on this repo
├── .github/
│   ├── workflows/ci.yml         lint + tests on every PR (no Ollama or keys needed)
│   └── pull_request_template.md every PR names its models and AI assistants
├── backend/                     FastAPI + SQLite + local Gemma
│   ├── app/
│   │   ├── main.py              app factory, /api/health, serves frontend/
│   │   ├── llm.py               the only module that talks to a model (Gemma via Ollama)
│   │   ├── trust.py             ALLOW / REVIEW / UNKNOWN / FLAG decision engine
│   │   ├── campaigns.py         MinHash/LSH campaign detection
│   │   ├── analysis.py          records, spam weight, trust lists, campaigns per project
│   │   ├── ingest.py            project zip upload and GitHub PR fetch
│   │   ├── github.py            public GitHub REST client (read-only)
│   │   ├── auth.py, jobs.py, db.py, models.py
│   │   └── routes/              auth.py, projects.py, deps.py
│   ├── scripts/                 load_project, make_test_project, export_examples, …
│   └── tests/                   pytest suite (offline: fake LLM, mocked GitHub)
├── frontend/                    plain HTML, CSS and ES modules, no build step
│   ├── index.html
│   ├── css/base.css
│   ├── js/                      app.js router, api.js, pages/, lib/
│   └── tests/                   node --test
└── examples/
    ├── input/                   d1-oppia.zip (real repo), synthetic-d2.zip (test fixture)
    └── output/                  real API responses produced with Gemma
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

## Models and tools

- **Product:** `gemma4:e2b`, open-weight, run locally with Ollama. This is the only model the code calls.
- **Development:** Claude Code helped write code. It is not part of the product, and each PR names it.

## License

[MIT](LICENSE)
