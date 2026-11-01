# HACKATHON.md

**Event:** Hacktoberfest 2026, Hack Day Sonipat (31 Oct to 1 Nov 2026)
**Venue:** Newton School of Technology, Rishihood University, Sonipat

## Team

**Team name:** Byte Bandits

**Members:**
1. Arin Jain
2. Tarun J Singh
3. Shreyansh Shekhar

## Selected problem statement

**Problem 07: Decentralized Trust Network for Open Source Contributions**

Projects keep public vouch and denounce records, share them with projects they choose to trust, detect coordinated spam campaigns across projects, and evaluate new contributors fairly, with no central authority.

## Models used

| Model | How it is run | Role in the product |
|---|---|---|
| `gemma4:e2b` | Locally through Ollama (`http://localhost:11434`) | Labels every pull request spam or genuine with a reason, gives the verdict and summary for each detected campaign, summarises a contributor's public GitHub activity, and explains each trust decision in plain English |

This is the only model the code calls (`backend/app/llm.py`, `DEFAULT_MODEL = "gemma4:e2b"`). `GET /api/health`
reports it, and `examples/output/health.json` shows it running.

### Why this model

- **Open-weight and local.** Gemma runs on our own laptops, so there are no cloud AI APIs, no API keys and no secrets in the repository. The app uses the internet only for public GitHub data, never for AI.
- **Good fit for text judgement.** Spam PRs are reworded templates that fixed rules miss. Gemma reads the title, body and diff and returns a strict JSON verdict with a one-line reason.
- **Runs on ordinary laptops.** We planned `gemma4:e4b`, but switched to the smaller `gemma4:e2b` so it runs within our laptops' memory alongside the app.

### What the model does and does not decide

- Gemma labels PRs and writes summaries. Ordinary code (`backend/app/trust.py`) turns those labels into vouch and denounce records, propagates trust between projects and makes the final decision (ALLOW / REVIEW / UNKNOWN / FLAG).
- Campaign detection itself is deterministic (MinHash similarity, time window, account age); Gemma reviews each detected cluster.
- A contributor with no records is **UNKNOWN** and is never blocked, whatever the model says.
- If Gemma is not running, the app says so, leaves PRs unclassified and uses template text for summaries. It never guesses a label.

## AI tools used during development (not part of the product)

These tools helped us build the project. None of them is called by the product at runtime, and the product needs no API keys.

| Tool | Used for |
|---|---|
| Claude Code | Writing and editing code |
| Claude | Research and learning (reading about concepts, brainstorming) |
| ChatGPT | Research and learning (reading about concepts, brainstorming) |

Each pull request also names the AI coding assistants that helped write it, as the PR template requires.

## Rules we follow

- This repository was created new and empty for the hackathon, and this file is the only content of the first commit.
- Every later change goes through a pull request that follows the template and passes CI.
- The repository is public and uses the MIT license.
- We list only models our code actually calls, and we will update this file if that changes.
- Every team member will be able to explain the code.
