"""Provider protocol, implementations, and registry."""

from src.vidmirror.core.providers.base import BaseProvider
from src.vidmirror.core.providers.registry import ProviderRegistry, create_default_registry
from src.vidmirror.core.providers.types import (
    ChatRequest,
    ProviderError,
    ProviderRequestError,
    ProviderTransientError,
)

__all__ = [
    "BaseProvider",
    "ChatRequest",
    "ProviderError",
    "ProviderRequestError",
    "ProviderTransientError",
    "ProviderRegistry",
    "create_default_registry",
]
