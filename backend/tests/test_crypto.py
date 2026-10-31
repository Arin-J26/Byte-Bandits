import pytest
from pydantic import ValidationError

from app.crypto import RecordRuleError, check_record_rules, generate_keypair, sign_record, verify_record
from app.models import RecordIn


def _record(**kw):
    rec = {
        "id": "rec-1",
        "issuer": "nebula-db",
        "subject_handle": "ada",
        "type": "vouch",
        "reason": "Great tests",
        "evidence_urls": ["https://example.com/pr/1"],
        "timestamp": "2026-10-31T10:00:00Z",
    }
    rec.update(kw)
    return rec


def test_sign_and_verify_roundtrip():
    priv, pub = generate_keypair(b"\x01" * 32)
    rec = _record()
    rec["signature"] = sign_record(rec, priv)
    assert verify_record(rec, pub)


def test_keypair_is_reproducible_from_seed():
    assert generate_keypair(b"\x02" * 32) == generate_keypair(b"\x02" * 32)


@pytest.mark.parametrize(
    "field,value",
    [
        ("reason", "Great tests!"),
        ("type", "denounce"),
        ("subject_handle", "eve"),
        ("evidence_urls", []),
        ("timestamp", "2026-11-01T10:00:00Z"),
    ],
)
def test_tampered_record_fails(field, value):
    priv, pub = generate_keypair(b"\x03" * 32)
    rec = _record()
    rec["signature"] = sign_record(rec, priv)
    rec[field] = value
    assert not verify_record(rec, pub)


def test_wrong_key_and_garbage_signature_fail():
    priv, _ = generate_keypair(b"\x04" * 32)
    _, other_pub = generate_keypair(b"\x05" * 32)
    rec = _record()
    rec["signature"] = sign_record(rec, priv)
    assert not verify_record(rec, other_pub)
    assert not verify_record({**rec, "signature": "zz"}, other_pub)


def test_signature_ignores_signature_valid_field():
    priv, pub = generate_keypair(b"\x06" * 32)
    rec = _record()
    rec["signature"] = sign_record(rec, priv)
    assert verify_record({**rec, "signature_valid": False}, pub)


def test_denounce_without_evidence_rejected():
    with pytest.raises(RecordRuleError):
        check_record_rules(_record(type="denounce", evidence_urls=[]))
    with pytest.raises(ValidationError):
        RecordIn(**_record(type="denounce", evidence_urls=["  "]), signature="ab" * 64)
    check_record_rules(_record(type="denounce"))  # with evidence: fine
