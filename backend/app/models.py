"""Pydantic request/response models. Response shapes match frontend/mock/*.json."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Id = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9._\-]+$")
Handle = Field(min_length=1, max_length=100)


class Project(BaseModel):
    id: str
    name: str


class TrustEdge(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    from_: str = Field(alias="from")
    to: str
    weight: float = Field(ge=0, le=1)


class TrustUpdate(BaseModel):
    project_id: str = Id
    peer_id: str = Id
    weight: float = Field(ge=0, le=1)


class TrustSettings(BaseModel):
    """Per-project evaluation settings (how far and how fast trust travels)."""

    project_id: str = Id
    max_depth: int = Field(ge=1, le=6)
    decay: float = Field(ge=0.5, le=1)


class RecordIn(BaseModel):
    """A signed record submitted by a project. Unknown fields are rejected."""

    model_config = ConfigDict(extra="forbid")
    id: str = Id
    issuer: str = Id
    subject_handle: str = Handle
    type: Literal["vouch", "denounce", "contest"]
    reason: str = Field(min_length=1, max_length=500)
    evidence_urls: list[str] = Field(default_factory=list, max_length=10)
    timestamp: str
    signature: str = Field(min_length=128, max_length=128, pattern=r"^[0-9a-fA-F]+$")

    @field_validator("evidence_urls")
    @classmethod
    def _urls(cls, v: list[str]) -> list[str]:
        for u in v:
            if len(u) > 500:
                raise ValueError("evidence URLs must be at most 500 characters")
        return v

    @field_validator("timestamp")
    @classmethod
    def _ts(cls, v: str) -> str:
        datetime.fromisoformat(v.replace("Z", "+00:00"))
        return v

    @model_validator(mode="after")
    def _denounce_needs_evidence(self) -> RecordIn:
        if self.type == "denounce" and not any(u.strip() for u in self.evidence_urls):
            raise ValueError("a denounce record needs at least one evidence URL")
        return self


class RecordOut(BaseModel):
    id: str
    issuer: str
    subject_handle: str
    type: str
    reason: str
    evidence_urls: list[str]
    timestamp: str
    signature_valid: bool


class EvaluateIn(BaseModel):
    project_id: str = Id
    handle: str = Handle


class PathItem(BaseModel):
    project: str
    via: list[str]
    weight: float
    record_id: str
    effect: float
    type: str


class IgnoredItem(BaseModel):
    record_id: str
    reason: str


class Evaluation(BaseModel):
    decision: Literal["ALLOW", "REVIEW", "UNKNOWN", "FLAG"]
    score: float
    summary: str
    path: list[PathItem]
    ignored: list[IgnoredItem]
    ai: bool


class SimulateIn(BaseModel):
    """Accepts both the documented snake_case names and the frontend's camelCase ones."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    projects: int = Field(default=40, ge=20, le=50, alias="projectCount")
    newcomers: int = Field(default=8, ge=0, le=60)
    campaign_size: int = Field(default=38, ge=0, le=80, alias="campaignSize")
    seed: int = Field(default=2026, ge=0, le=2**31 - 1)
    preset: Literal["demo", "github"] | None = None


class ClusterVerdict(BaseModel):
    verdict: Literal["spam", "legit", "unclear"]
    reason: str = Field(max_length=400)


class ProjectExport(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Id
    name: str = Field(min_length=1, max_length=200)
    public_key: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-fA-F]+$")
    max_depth: int = Field(default=3, ge=1, le=6)
    decay: float | None = Field(default=None, ge=0.5, le=1)


class RecordExport(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Id
    issuer: str = Id
    subject_handle: str = Handle
    type: Literal["vouch", "denounce", "contest"]
    reason: str = Field(max_length=500)
    evidence_urls: list[str] = Field(default_factory=list, max_length=10)
    timestamp: str
    signature: str = Field(max_length=256)


class PrEventExport(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Id
    project_id: str = Id
    handle: str = Handle
    account_age_days: int = Field(ge=0, le=100000)
    title: str = Field(max_length=300)
    body_excerpt: str = Field(default="", max_length=2000)
    diff_text: str = Field(default="", max_length=20000)
    created_at: str


class NetworkIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    projects: list[ProjectExport] = Field(min_length=1, max_length=500)
    trust_edges: list[TrustEdge] = Field(max_length=10000)
    records: list[RecordExport] = Field(default_factory=list, max_length=50000)
    pr_events: list[PrEventExport] = Field(default_factory=list, max_length=50000)
