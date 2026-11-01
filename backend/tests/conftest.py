import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Tests never touch the real DB and never need Ollama or GitHub (live tests opt in with SNIFFER_LIVE=1).
os.environ.setdefault("SNIFFER_DB", str(Path(tempfile.mkdtemp(prefix="sniffer-test-")) / "test.db"))
if os.environ.get("SNIFFER_LIVE") != "1":
    os.environ["OLLAMA_HOST"] = "http://127.0.0.1:9"
