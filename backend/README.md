# Sniffer backend

Serves the maintainer portal (the frontend in `frontend/`) and its JSON API under `/api`. Everything is read from
the maintainers' own uploads and from public GitHub data. Gemma runs locally through Ollama and is the only AI.

Stack: Python 3.11+, FastAPI, Uvicorn, SQLite (stdlib), httpx (GitHub's public REST API), the `ollama` package,
pydantic, datasketch (MinHash), pytest, ruff.

## Run

```bash
ollama pull gemma4:e2b                       # once; keep the Ollama app running
python3 -m venv backend/.venv
backend/.venv/bin/pip install -e "backend[dev]"
backend/.venv/bin/uvicorn app.main:app --app-dir backend --port 8000
```

Open http://localhost:8000. Optional: `export GITHUB_TOKEN=...` raises GitHub's rate limit (60 requests an hour without
one). Nothing is written to GitHub.

## The first project

Uploading needs a signed-in maintainer, and signing up needs a project that lists you. So the first project is loaded
from the command line, as one of the maintainers it names:

```bash
backend/.venv/bin/python backend/scripts/load_project.py examples/input/d1-oppia.zip --as Arin-J26
```

After that, maintainers sign up and upload more projects in the app.

## Project zip format

A zip with `project.json` at its root (or inside one top-level folder), and optionally `prs.json`:

```json
{ "id": "d1", "name": "D1", "github": "owner/repo", "maintainers": ["GitHubLogin"] }
```

`prs.json` (optional) is a list of pull requests: `number`, `author`, `title`, `body`, `created_at`, `merged`, `url`,
`diff`, and optionally `account_age_days`. Without it, the most recent 30 pull requests are read from GitHub (with
diffs for the first 30). The zip is capped at 5 MB and 20 MB uncompressed. Uploading a project again refreshes it, but
only for one of its listed maintainers.

## Accounts

- **Sign up:** a GitHub username and a password (10+ characters). The username must exist on GitHub and be listed as a
  maintainer in an uploaded project. Passwords are hashed with PBKDF2-SHA256 (200,000 iterations) per account.
- **Sign in:** the same username and password. The session is an HttpOnly, same-site cookie valid for 12 hours.
- **Limit:** GitHub does not accept passwords through its API, so the password is Sniffer's own. Proving that someone
  owns a GitHub account needs GitHub sign-in (OAuth), which is not implemented.

## What each feature does

Every project feature requires a signed-in maintainer who is listed on that project. Other projects return 404.

| Feature | Endpoint | What it does |
|---|---|---|
| Dashboard | `GET /api/projects` | This maintainer's projects with merged PRs, trust edges, vouchers, denounces, flagged accounts and campaigns. |
| Overview | `GET /api/projects/{id}` | The same numbers for one project only. |
| Classify | `POST /api/projects/{id}/classify`, `GET .../classify` | Gemma labels each PR spam or not spam, in a background job with progress. |
| Graph | `GET .../graph` | Genuine and spam PRs per month, for a bar chart. |
| Records | `GET .../records?handle=` | One contributor's PRs as PR1, PR2, ...: subject, type, and reason, evidence and timestamp for spam only. |
| Evaluate | `POST .../evaluate` | A decision for one contributor, from the same trust rules, fed by this maintainer's classifications. |
| GitHub check | `GET .../contributors/{handle}/github` | Public GitHub facts about the contributor, and a Gemma summary of them. |
| Campaigns | `GET .../campaigns?window_minutes=&min_size=` | Bursts of near-identical PRs from young accounts, with Gemma's verdict. |
| Suggest denounce | `POST .../campaigns/{id}/suggest` | Unsigned proposals only. Nothing is stored, signed or sent. |
| Trust | `GET .../trust` | Two lists: trusted (by how many projects) and not trusted. |

## How the numbers are made

- **Spam:** Gemma reads each PR's title, description, diff excerpt and account age, and answers strict JSON
  `{"spam": bool, "reason": ...}`. Invalid JSON is retried once. If Gemma cannot answer, the PR stays "unclassified" and is
  never guessed.
- **Trust:** a contributor's PRs in one project become one summary per project. "Denounce" when most of them are spam,
  "vouch" when any are genuine. Projects of the same maintainer trust each other at weight 0.8. Decay, depth and the
  two-project FLAG rule come from `app/trust.py`.
- **One project cannot FLAG.** A FLAG needs two independent projects that both see spam, so with a single project the
  most a contributor can get is REVIEW. Loading a second project makes FLAG possible.
- **GitHub trust:** GitHub has no vouch or denounce feature. The honest proxy is how many other repositories have merged
  this contributor's PRs. The app shows that number, and says so.
- **Campaigns:** MinHash/LSH groups near-identical PRs. A campaign must come from young accounts (median 30 days or less) within the chosen window, and have the chosen minimum size. It can span the maintainer's projects, and each campaign reports how many projects it reaches. Gemma gives a verdict and summary.
  (median 30 days or less) within the chosen window, and have the chosen minimum size. Gemma gives a verdict and summary.
- **Unknown accounts:** no history means UNKNOWN: "Normal review, not blocked." Enforced in code.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `SNIFFER_DB` | `backend/sniffer.db` | SQLite file (git-ignored). A file from the old synthetic design is moved aside, never deleted. |
| `SNIFFER_MODEL` | `gemma4:e2b` | Ollama model name |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server |
| `SNIFFER_AI_BUDGET` | `6` | Seconds a request waits for Gemma before showing template text (the model keeps working in the background) |
| `GITHUB_TOKEN` | unset | Optional, raises GitHub's rate limit |
| `SNIFFER_FRONTEND` | `frontend/` | Static files directory |

## Checks

```bash
backend/.venv/bin/ruff check backend
backend/.venv/bin/pytest backend        # offline: Gemma and GitHub are replaced by fakes
SNIFFER_LIVE=1 backend/.venv/bin/pytest backend -m live
```

## Honest limits

- D1 is the oppia repository zip you provided. D2 is a synthetic test project (`examples/input/synthetic-d2.zip`) with
  fictional contributors. Replace D2 with your own zip when you have it.
- Gemma's spam label is a judgement from a small local model. It is shown with its reason so a maintainer can check it.
- FLAG needs two projects that both denounce an account. D1 has no spam, so spam in D2 reaches REVIEW or ALLOW, not FLAG.
- Sign-up checks that a GitHub user exists, not that the person owns the account.
- Login has no rate limit yet.
