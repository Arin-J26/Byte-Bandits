# Sniffer frontend

The maintainer portal: plain HTML, CSS and ES modules. No framework, no build step, no `npm install`, no CDN.
It talks only to the backend's `/api` (same origin), and the session is an HttpOnly cookie.

## Use it

Start the backend (see `backend/README.md`), then open http://localhost:8000.

1. **Sign in** (or sign up with a GitHub username that is listed as a maintainer of an uploaded project).
2. **Dashboard:** your projects with their numbers. **Add project (zip)** uploads a project file.
3. **Open a project.** Only then do the tabs appear:
   - **Overview:** this project's numbers, and the Gemma classification button.
   - **Graph:** genuine vs spam PRs per month.
   - **Evaluate:** decide one contributor, with the animated trust path and a GitHub check.
   - **Campaigns:** choose a time window and minimum cluster size; Gemma reviews each cluster.
   - **Records:** search a contributor and see PR1, PR2, ... with spam or not-spam, type, and reason, evidence and timestamp.
   - **Trust:** trusted and not-trusted contributors, as two plain lists.

The header shows **Gemma ready** when the local model is installed. If the backend stops, a banner says so.

## Tests

```bash
node --test frontend/tests/*.test.js
```

These check the pure logic, the design tokens (WCAG contrast in both themes), and that only `js/api.js` calls `fetch`
and nothing assigns `innerHTML` with a variable.

## Layout

```
index.html            shell
css/base.css          design tokens and layout
js/app.js             sign-in gate, router, project tabs
js/api.js             the only module that calls the backend
js/pages/             login, dashboard, project (overview), graph, evaluate, campaigns, records, trust
js/pages/evalGraph.js and campaignRadar.js   the animated trust path and the campaign radar
js/lib/               format, decision styles, campaign statistics
```
