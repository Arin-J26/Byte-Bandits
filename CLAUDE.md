# CLAUDE.md

Rules for AI coding assistants working on the Sniffer frontend.

- Git: do not run `git add`, `commit`, `push` or any `gh` command, and do not open PRs. Only create or edit files.
- Work only inside `frontend/` (plus this file).
- Plain HTML, CSS and JavaScript ES modules. No frameworks, no build step, no runtime CDN, no `npm install` needed to run. System font stack only.
- Never call any AI API from the frontend. No secrets, keys or tokens. Synthetic data only.
- Never put data into `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `eval`. Use `textContent` and `createElement` (see `js/dom.js`). Handles, reasons and PR titles are attacker-controlled.
- All backend calls go through `js/api.js`. Mock mode: `?mock=1`, or automatic when `/api` is unreachable; reads `frontend/mock/*.json`. The badge must show Live or Mock honestly.
- Pure logic lives in `js/lib/` with tests in `frontend/tests/` (`node --test frontend/tests/*.test.js`).
- Animate with transform/opacity via `requestAnimationFrame`, cap particles, pause when the tab is hidden, respect `prefers-reduced-motion` and Quiet mode.
- Accessibility: keyboard navigable, ARIA labels, visible focus, WCAG AA contrast. Colour is never the only signal: ✓ = ALLOW, ! = REVIEW/UNKNOWN, ✕ = FLAG.
- Colours: green = ALLOW/vouch, amber = REVIEW/unknown, red = FLAG/denounce, cyan = neutral accent.
- If `docs/API.md` exists, its API shapes win over the ones assumed in `js/api.js`.
