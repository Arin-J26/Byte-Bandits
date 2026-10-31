"""Generate examples/ and docs/API.md from REAL responses of the running app code.

Simulates the network with a fixed seed in a temporary database, calls every endpoint in-process,
and saves the outputs. Uses the local Gemma model when Ollama is reachable (ai=true), otherwise the
deterministic fallback (ai=false).

    backend/.venv/bin/python backend/scripts/make_examples.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("SNIFFER_AI_BUDGET", "60")  # wait for Gemma so the examples show its output
os.environ["SNIFFER_DB"] = str(Path(tempfile.mkdtemp(prefix="sniffer-examples-")) / "examples.db")

from fastapi.testclient import TestClient  # noqa: E402

from app.crypto import sign_record  # noqa: E402
from app.main import create_app  # noqa: E402

SEED = 2026
EX_IN, EX_OUT = ROOT / "examples" / "input", ROOT / "examples" / "output"


def save(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def short(data, n=2):
    """Trim long lists for the docs (full outputs live in examples/)."""
    if isinstance(data, list):
        return [short(x, n) for x in data[:n]] + (["…"] if len(data) > n else [])
    if isinstance(data, dict):
        return {k: short(v, n) for k, v in data.items()}
    if isinstance(data, str) and len(data) > 160:
        return data[:157] + "…"
    return data


def main() -> None:
    app = create_app(seed_demo=False)
    c = TestClient(app)
    calls: list[tuple[str, str, object, object, int]] = []

    def call(method: str, path: str, body=None, raw=False):
        r = c.request(method, path, json=body)
        out = r.json()
        calls.append((method, path, body, out, r.status_code))
        return out

    call("POST", "/api/simulate/load", {"projects": 40, "newcomers": 8, "campaign_size": 38, "seed": SEED})
    health = call("GET", "/api/health")
    call("GET", "/api/projects")
    call("GET", "/api/trust-edges")
    call("GET", "/api/records")
    outputs = {
        "evaluate-allow.json": ("ada-commits", "vouched contributor, reached through a trusted peer"),
        "evaluate-unknown.json": ("newbie-nora", "honest newcomer with no history"),
        "evaluate-flag.json": ("spam-bot-7731", "spam account denounced by 3 trusted projects"),
        "evaluate-review-lone-denounce.json": ("solo-denounce-sam", "a single (mistaken) denounce"),
        "evaluate-contested.json": ("contested-carl", "denounces contested by a sponsor"),
    }
    for fname, (handle, _) in outputs.items():
        save(
            EX_OUT / fname,
            {
                "request": {"project_id": "lumen-ui", "handle": handle},
                "response": call("POST", "/api/evaluate", {"project_id": "lumen-ui", "handle": handle}),
            },
        )
    campaigns = call("GET", "/api/campaigns")
    save(EX_OUT / "campaigns.json", campaigns)
    if campaigns:
        save(
            EX_OUT / "suggest-denounce.json",
            call("POST", f"/api/campaigns/{campaigns[0]['id']}/suggest-denounce", {"issuer": "lumen-ui"}),
        )
    call("GET", "/api/events")
    call("PUT", "/api/trust", {"project_id": "lumen-ui", "peer_id": "pyforge", "weight": 0.8})

    rec = {
        "id": "rec-example-1",
        "issuer": "nebula-db",
        "subject_handle": "newbie-nora",
        "type": "vouch",
        "reason": "First PR merged with tests",
        "evidence_urls": ["https://example.com/nebula-db/pull/1001"],
        "timestamp": "2026-11-01T09:00:00Z",
    }
    rec["signature"] = sign_record(rec, app.state.db.private_key("nebula-db"))
    call("POST", "/api/records", rec)
    call("POST", "/api/records", {**rec, "id": "rec-example-2", "reason": "tampered after signing"})

    network = call("GET", "/api/network/export")
    save(EX_IN / "network.json", network)
    call("POST", "/api/network/import", network)
    save(EX_OUT / "health.json", health)
    write_api_docs(calls, outputs)
    print(f"Wrote examples/ and docs/API.md (ollama_available={health['ollama_available']}, model={health['model']})")


DOC_NOTES = {
    "GET /api/health": "Liveness plus whether the local Ollama server answers.",
    "POST /api/simulate/load": "Replace all data with a seeded synthetic network. Body fields are optional. "
    "Accepts `projects` (20-50), `newcomers`, `campaign_size` (number of spam PRs), `seed`, or the frontend's "
    '`projectCount`/`campaignSize`, or `{"preset": "demo"}`.',
    "GET /api/projects": "All projects. Keys are never returned.",
    "GET /api/trust-edges": "Directed trust edges, weight 0..1.",
    "GET /api/records": "All signed records (signature bytes omitted; `signature_valid` tells you the result).",
    "POST /api/evaluate": "Explainable decision for a handle from one project's perspective. `via` is the chain "
    "of projects trust travelled through. `ai` is true when the summary came from Gemma.",
    "GET /api/campaigns": "Clusters found by MinHash/LSH + burst + young-account filters, with Gemma's verdict.",
    "GET /api/events": "PR and record events, newest first. `?limit=` (1-1000, default 100).",
    "PUT /api/trust": "Set (or create) a trust edge.",
    "POST /api/records": "Append a signed record. 400 on a bad signature, 409 on a duplicate id, 422 when a "
    "denounce has no evidence URL, 404 for an unknown issuer. No update or delete endpoints exist.",
    "GET /api/network/export": "Full network for backup or sharing. Private keys are never included.",
    "POST /api/network/import": "Replace the network with an exported one (max 5 MB). Signatures are verified "
    "on import and `signature_valid` is recomputed.",
}


def write_api_docs(calls, outputs) -> None:
    lines = [
        "# Sniffer API",
        "",
        "All endpoints live under `/api` on the same origin as the frontend (default http://localhost:8000).",
        'Requests and responses are JSON. Errors look like `{"error": "message"}` (or, for validation '
        'errors, `{"error": "Invalid request", "details": [...]}`) with a matching HTTP status.',
        "",
        "Every example below is real output, generated by `backend/scripts/make_examples.py` with seed "
        f"{SEED} (long lists are trimmed; full outputs are in `examples/output/`). Interactive docs: `/api/docs`.",
        "",
        "## Contents",
        "",
    ]
    seen = []
    for method, path, *_ in calls:
        key = f"{method} {path.split('/suggest')[0] if '/campaigns/camp-' in path else path}"
        if "/campaigns/camp-" in path:
            key = "POST /api/campaigns/{id}/suggest-denounce"
        if key not in seen:
            seen.append(key)
    lines += [f"- `{k}`" for k in seen] + [""]
    done = set()
    for method, path, body, out, status in calls:
        key = "POST /api/campaigns/{id}/suggest-denounce" if "/campaigns/camp-" in path else f"{method} {path}"
        first = key not in done
        done.add(key)
        if first:
            lines += [f"## `{key}`", ""]
            if key in DOC_NOTES:
                lines += [DOC_NOTES[key], ""]
            if key == "POST /api/campaigns/{id}/suggest-denounce":
                lines += [
                    "Proposed, **unsigned** denounce records for a cluster. Nothing is stored, signed or sent. "
                    'Optional body `{"issuer": "<project id>"}`.',
                    "",
                ]
        if body is not None:
            req = body if key != "POST /api/network/import" else "<the JSON from GET /api/network/export>"
            if key == "POST /api/evaluate":
                note = next((d for h, d in outputs.values() if h == body["handle"]), "")
                lines += [f"**Request** ({note}):" if note else "**Request:**", ""]
            else:
                lines += ["**Request:**", ""]
            lines += ["```json", json.dumps(short(req, 3), indent=2, ensure_ascii=False), "```", ""]
        lines += [
            f"**Response** `{status}`:",
            "",
            "```json",
            json.dumps(short(out), indent=2, ensure_ascii=False),
            "```",
            "",
        ]
    (ROOT / "docs").mkdir(exist_ok=True)
    (ROOT / "docs" / "API.md").write_text("\n".join(lines))


if __name__ == "__main__":
    main()
