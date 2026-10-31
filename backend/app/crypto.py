"""ed25519 signing for trust records (PyNaCl).

A record is {id, issuer, subject_handle, type, reason, evidence_urls, timestamp, signature}.
The signature covers a canonical JSON serialization of every field except `signature`
(sorted keys, compact separators, UTF-8). Private keys exist only in the dev/simulation DB.
"""

from __future__ import annotations

import json

from nacl.exceptions import BadSignatureError
from nacl.signing import SigningKey, VerifyKey

SIGNED_FIELDS = ("id", "issuer", "subject_handle", "type", "reason", "evidence_urls", "timestamp")
RECORD_TYPES = ("vouch", "denounce", "contest")


class RecordRuleError(ValueError):
    """A record breaks a content rule (not a signature problem)."""


def generate_keypair(seed: bytes | None = None) -> tuple[str, str]:
    """Return (private_key_hex, public_key_hex). A 32-byte seed makes it reproducible."""
    sk = SigningKey(seed) if seed is not None else SigningKey.generate()
    return sk.encode().hex(), sk.verify_key.encode().hex()


def canonical_bytes(record: dict) -> bytes:
    payload = {k: record.get(k) for k in SIGNED_FIELDS}
    payload["evidence_urls"] = list(payload["evidence_urls"] or [])
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sign_record(record: dict, private_key_hex: str) -> str:
    sk = SigningKey(bytes.fromhex(private_key_hex))
    return sk.sign(canonical_bytes(record)).signature.hex()


def verify_record(record: dict, public_key_hex: str) -> bool:
    try:
        VerifyKey(bytes.fromhex(public_key_hex)).verify(canonical_bytes(record), bytes.fromhex(record["signature"]))
        return True
    except (BadSignatureError, ValueError, TypeError, KeyError):
        return False


def check_record_rules(record: dict) -> None:
    """Content rules that apply regardless of signature."""
    if record.get("type") not in RECORD_TYPES:
        raise RecordRuleError(f"type must be one of {', '.join(RECORD_TYPES)}")
    if record["type"] == "denounce" and not [u for u in record.get("evidence_urls") or [] if str(u).strip()]:
        raise RecordRuleError("a denounce record needs at least one evidence URL")
