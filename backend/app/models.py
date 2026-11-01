"""Request and response models (pydantic validates every input)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Credentials(BaseModel):
    login: str = Field(min_length=1, max_length=39)
    password: str = Field(min_length=1, max_length=200)


class EvaluateIn(BaseModel):
    handle: str = Field(min_length=1, max_length=39)


class ClusterVerdict(BaseModel):
    verdict: Literal["spam", "legit", "unclear"]
    reason: str = Field(max_length=400)


class PrVerdict(BaseModel):
    spam: bool
    reason: str = Field(max_length=300)


class SuggestIn(BaseModel):
    issuer: str | None = Field(default=None, max_length=100)


class DecisionIn(BaseModel):
    """A maintainer's own choice for a contributor. Nothing sets this automatically."""

    action: Literal["block", "accept", "clear"]
