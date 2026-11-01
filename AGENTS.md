# AGENTS.md

Rules for AI coding assistants working on Sniffer.

- **Git:** do not run `git add`, `commit`, `push` or any `gh` command, and do not open PRs unless the user explicitly asks.
- **Model:** the only AI is `gemma4:e2b` through a local Ollama server. Never import or call any cloud AI SDK or API, not even as a fallback. No API keys or secrets in the code.
- **Data:** only real data: maintainer uploads and public GitHub data. No synthetic network inside the app code. `examples/input/d1-oppia.zip` is a real repository; `examples/input/synthetic-d2.zip` is a clearly labelled test fixture with fictional accounts.
- **Decisions:** ALLOW / REVIEW / UNKNOWN / FLAG come from `backend/app/trust.py` and are never changed by the model. Gemma labels PRs, writes summaries, and gives campaign verdicts.
- **Access:** every project feature checks that the signed-in maintainer is listed on that project.
- **Frontend:** plain HTML, CSS and ES modules. Build text with `textContent` and `createElement`, never `innerHTML` with data. All backend calls go through `js/api.js`.
- **Tests:** keep `ruff check backend`, `pytest backend` and `node --test frontend/tests/*.test.js` green.
