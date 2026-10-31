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

| Model | How it is run | Planned role in the product |
|---|---|---|
| `gemma4:e4b` | Locally through Ollama (`http://localhost:11434`) | Language judgement and explanation (see below) |

### Why this model

- **Open-weight and local.** Gemma runs on our own laptops, so there are no cloud AI APIs, no API keys and no secrets in the repository.
- **Good fit for text judgement.** The model does language work that fixed rules handle badly: recognising reworded spam templates, rating whether a denouncement gives concrete evidence, assessing pull request quality, and writing plain-English explanations for maintainers.
- **Runs on ordinary laptops.** The `e4b` size works on most laptops. If a laptop is short on memory we will switch to `gemma4:e2b` and update this file.

### What the model does and does not decide

- The model produces signals (confidence scores and one-line reasons). Ordinary code handles trust propagation between projects and makes the final decision.
- A contributor with no records is treated as **unknown**, never as suspicious, whatever the model says.
- The tool keeps working with rule-based fallbacks if the model is unavailable.

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
