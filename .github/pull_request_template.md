## What this PR changes

<!-- One or two sentences. -->

## Models used by the product in this PR

<!-- Every model the code in this PR calls at runtime. Sniffer uses only open-weight models run locally. -->

- [ ] `gemma4:e2b` via local Ollama (`http://localhost:11434`)
- [ ] No model is called by this change

No closed model APIs (OpenAI, Claude, Gemini, ...) and no API keys or secrets.

## AI coding assistants that helped write this PR

<!-- For example: Claude Code. Write "none" if none. -->

## Checks

- [ ] `ruff check backend` and `pytest backend` pass
- [ ] `node --test frontend/tests/*.test.js` passes
- [ ] `examples/` still matches what the tool produces (if behaviour changed)
