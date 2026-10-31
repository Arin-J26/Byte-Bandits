# Sniffer frontend

The "Trust Command Center" for Sniffer: a decentralized trust network for open-source contributions.
Plain HTML, CSS and ES modules. No framework, no build step, no `npm install`.

## Run the frontend

Sniffer runs on its backend, which also serves this frontend and talks to the local Gemma model in Ollama.
From the repository root:

```bash
ollama pull gemma4:e2b                                                 # once; keep the Ollama app running
backend/.venv/bin/uvicorn app.main:app --app-dir backend --port 8000
```

Open **http://localhost:8000**. The header shows **Live** and **✦ Gemma** when everything is connected. Setup details are
in `backend/README.md`.

- If the backend is not running, the page shows a start screen with these commands and reconnects by itself.
- If the backend drops mid-session, a banner says "Reconnecting…" and the page recovers when it is back. It never
  silently switches to fake data.
- If Ollama is off or the model is not pulled, the chip shows **Ollama off** or **Gemma not pulled**. Decisions still
  work, and summaries fall back to plain templates until Gemma is back.
- **Demo data only on request:** `http://localhost:8000/?mock=1` runs on the synthetic files in `frontend/mock/` with no
  backend and no Gemma (badge: **Demo data**).

Run the tests (Node 18+, no dependencies):

```bash
node --test frontend/tests/*.test.js
```

(Node 22+ no longer accepts a bare directory such as `node --test frontend/tests`; the glob works on every version.)

## Page tour

| Page | What it shows |
|---|---|
| **Overview** (start page) | What Sniffer is, a quick "evaluate a handle" box with example handles, live network stats, how it works, what each decision means, activity sparkline, most trusted projects. |
| **Graph** | Projects as nodes (sized by connections), trust edges sized by weight, flagged accounts as red diamonds linked to the projects they hit. Hover a node to spotlight its neighbours; click it (or use "Jump to node") for who it trusts, who trusts it and its recent records. Search, fit, reset layout, legend. |
| **Evaluate** | The core demo. Pick a project perspective, type a handle, press Evaluate. Pulses travel along the trust path, the verdict card shows ALLOW / REVIEW / UNKNOWN / FLAG with an explanation you can click through, a gauge shows the score, "What if?" sliders change trust live, recent evaluations are one click away, and "Copy explanation" gives a plain-text summary for a PR comment. |
| **Campaigns** | Radar and timeline of PR events, "Replay spam wave", evidence cards per campaign, "Suggest denounce records" (display only, sends nothing), and a live ticker. |
| **Records** | Every signed vouch/denounce: search, sort, filter, paginate, export JSON/CSV, detail drawer with evidence links. |
| **Trust** | Choose your project, tune peer weights, max depth and decay, and preview effective transitive trust before saving. |
| **Simulate** | Load the curated demo network, generate a seeded synthetic network, import a network JSON (max 5 MB, validated), or download the current one. |

**Start demo** in the header runs a guided 8-minute pitch (6 steps) that drives the real UI.
Use Next/Back, or Esc to exit. It runs on the live backend (or on demo data with `?mock=1`).

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl`/`⌘` + `K` | Command palette: jump to any page, run actions, evaluate any handle |
| `g` then `h` | Overview |
| `g` then `g` / `e` / `c` / `r` / `t` / `s` | Graph / Evaluate / Campaigns / Records / Trust / Simulate |
| `/` | Focus the search box on the current page |
| `?` | Show the shortcut overlay |
| `Esc` | Close dialogs, drawers and the demo |

## Look and feel

Light "paper and ink" theme by default: warm off-white background with a faint dot grid and soft colour washes, white
cards with gentle shadows, serif display headings (system serif such as New York or Georgia), monospace for data, and a
deep-teal accent. The ☾ / ☀ button in the header (or the command palette) switches to the dark neon theme; the choice
is remembered.

Every colour is a token in `css/base.css`. Canvas drawings and the graph read the same tokens (`js/theme.js`), so
both themes stay consistent. `tests/contrast.test.js` checks that text colours meet WCAG AA in both themes.

## Quiet mode and sound

All sound is synthesised with the Web Audio API (no audio files) and starts only after your first click or key press.
Mute and volume are in the header and saved in this browser. **Quiet mode** turns off sound and reduces motion
(no pulses, flashes, typewriter or background animation). The app also respects the operating system's
"reduce motion" setting.

## How decisions work in demo-data mode

`js/lib/trustMath.js` mirrors the backend rules so mock mode is honest:

- Your own project has trust 1.0. Each hop multiplies by the edge weight and by the decay (default 0.8), so two full-trust hops give 0.8 then 0.64.
- Projects beyond the max depth (default 3), untrusted projects and invalid signatures are ignored, each with a reason.
- Vouches add trust, denounces subtract it. Score is clamped to −1…+1.
- **UNKNOWN**: no usable records. Normal review, never blocked.
- **FLAG** needs a score ≤ −0.5 **and** at least two independent trusted denouncing projects. A single denounce is only a soft signal (REVIEW).

## Layout

```
frontend/
  index.html            app shell
  css/                  base (tokens, layout), components, pages
  js/app.js             router, header, shortcuts
  js/api.js             the only module that calls the backend; reconnects; demo data only with ?mock=1
  js/sound.js           Web Audio effects
  js/demo.js            guided demo
  js/pages/             one module per page (+ canvas helpers)
  js/lib/               pure logic, unit tested
  mock/                 synthetic API responses
  tests/                node --test
  vendor/               Cytoscape.js (see vendor/README.md)
```

Security: all data is rendered with `textContent`/`createElement`; a test fails the build if any file assigns
`innerHTML` with a variable. Evidence URLs are shown as text with a copy button; opening one asks first and uses
`rel="noopener noreferrer"`.
