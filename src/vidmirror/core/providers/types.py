"""Typed provider request/response models."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

ProviderCapability = str


class ProviderError(RuntimeError):
    """Base provider exception."""


class ProviderRequestError(ProviderError):
    """Non-retryable request/provider errors."""


class ProviderTransientError(ProviderError):
    """Retryable errors (rate limit, transient network)."""


@dataclass(frozen=True)
class ChatRequest:
    model: str
    messages: list[dict[str, Any]]
    temperature: float = 0.7
    max_tokens: int = 2048
    timeout: int | None = None
