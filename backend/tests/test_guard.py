"""Fails if anything under backend/ imports or mentions a cloud AI SDK or API.
The only model is a local Gemma via Ollama."""

import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
SKIP_DIRS = {".venv", "__pycache__", ".pytest_cache", ".ruff_cache"}
# Built from parts so this file does not match itself.
FORBIDDEN = [
    r"\bopen" + r"ai\b",
    r"\banthro" + r"pic\b",
    r"google\.generative" + r"ai",
    r"\bgen" + r"ai\b",
    r"generative" + r"language",
    r"api\.open" + r"ai\.com",
]


def scanned_files():
    for p in BACKEND.rglob("*"):
        if (
            p.is_file()
            and not SKIP_DIRS & set(p.relative_to(BACKEND).parts)
            and p.suffix
            in {
                ".py",
                ".toml",
                ".md",
                ".txt",
                ".sh",
                ".cfg",
                ".ini",
                ".json",
                ".yaml",
                ".yml",
            }
        ):
            yield p


def test_files_are_scanned():
    names = {p.name for p in scanned_files()}
    assert {"llm.py", "main.py", "pyproject.toml"} <= names


def test_no_cloud_ai_references():
    hits = []
    for p in scanned_files():
        text = p.read_text(errors="ignore")
        for pat in FORBIDDEN:
            if re.search(pat, text, re.I):
                hits.append(f"{p.relative_to(BACKEND)}: {pat}")
    assert hits == []
