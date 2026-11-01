# Examples

Sample input and the real output Sniffer produced from it.

## Input

| File | What it is |
|---|---|
| `input/d1-oppia.zip` | A real repository: the `oppia/oppia` source. Sniffer reads `project.json` metadata and fetches its 30 most recent public PRs from GitHub. Loaded as project **D1**. |
| `input/synthetic-d2.zip` | A **test fixture** with fictional accounts (`test-spam-NN`, `test-genuine-NN`) and invented PRs, built by `backend/scripts/make_test_project.py`. It holds a spam campaign (13 three-day-old accounts, 38 near-identical typo PRs in 107 minutes) and spam weights from 5% to 100%. Loaded as project **D2**. No real person is involved. |

## Output

Every file in `output/` is an API response body, exactly as the app returned it, written by
`backend/scripts/export_examples.py`. Every PR label, summary and campaign verdict in them was produced by
`gemma4:e2b`, running locally through Ollama. Trust decisions come from `backend/app/trust.py`.

| File | Shows |
|---|---|
| `health.json` | The model in use (`gemma4:e2b`) and that Ollama is running |
| `dashboard.json`, `d1-overview.json`, `d2-overview.json` | Per-project counts: PRs, vouchers, denounces, spam weight, campaigns |
| `d2-campaigns.json` | The detected campaign with Gemma's verdict and summary |
| `d2-trust.json`, `d1-trust.json` | Trusted (0% spam) and not-trusted (1-100% spam) contributors |
| `d2-records-test-spam-07.json` | One contributor's PRs, each labelled spam or not spam with Gemma's reason |
| `d2-evaluate-*.json` | Decisions for a 100% spam account, a 5% spam account, a genuine contributor and an unknown handle |
| `d2-graph.json` | Genuine and spam PRs per month |

## Reproduce

```bash
ollama pull gemma4:e2b
backend/.venv/bin/python backend/scripts/load_project.py examples/input/d1-oppia.zip --as Arin-J26 --id d1 --name "D1 (oppia)" --github oppia/oppia
backend/.venv/bin/python backend/scripts/load_project.py examples/input/synthetic-d2.zip --as Arin-J26 --replace
# classify both projects in the app (Overview → Classify), then:
backend/.venv/bin/python backend/scripts/export_examples.py
```
