"""Provider registry and profile-based resolver."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from shared.settings_store import AppSettings, ProviderProfile
from src.vidmirror.core.providers.anthropic_provider import AnthropicProvider
from src.vidmirror.core.providers.base import BaseProvider
from src.vidmirror.core.providers.openai_compat_provider import OpenAICompatProvider
from src.vidmirror.core.providers.types import ProviderRequestError

ProviderFactory = Callable[[ProviderProfile], BaseProvider]


@dataclass
class ProviderRegistry:
    _factories: dict[str, ProviderFactory]

    def register(self, provider_kind: str, factory: ProviderFactory) -> None:
        self._factories[provider_kind] = factory

    def build(self, profile: ProviderProfile) -> BaseProvider:
        if profile.kind not in self._factories:
            raise ProviderRequestError(f"unsupported provider kind: {profile.kind}")
        return self._factories[profile.kind](profile)

    def list_profiles(self, settings: AppSettings, capability: str | None = None) -> list[ProviderProfile]:
        out: list[ProviderProfile] = []
        for p in settings.providers:
            if not p.enabled:
                continue
            if capability and capability not in p.capabilities:
                continue
            out.append(p)
        return out

    def resolve_default_profile(self, settings: AppSettings, capability: str) -> ProviderProfile:
        preferred_id = {
            "chat": settings.default_provider_for_chat,
            "vision": settings.default_provider_for_vision,
            "embedding": settings.default_provider_for_embedding,
            "rerank": settings.default_provider_for_rerank,
        }.get(capability, "")
        for p in settings.providers:
            if p.enabled and p.id == preferred_id and capability in p.capabilities:
                return p
        for p in settings.providers:
            if p.enabled and capability in p.capabilities:
                return p
        raise ProviderRequestError(f"no enabled provider for capability: {capability}")


def create_default_registry() -> ProviderRegistry:
    registry = ProviderRegistry(_factories={})
    registry.register(
        "openai_compatible",
        lambda p: OpenAICompatProvider(
            provider_id=p.id,
            display_name=p.name,
            api_key=p.api_key,
            base_url=p.base_url,
            capabilities=p.capabilities,
        ),
    )
    registry.register(
        "anthropic",
        lambda p: AnthropicProvider(
            provider_id=p.id,
            display_name=p.name,
            api_key=p.api_key,
            base_url=p.base_url,
            capabilities=p.capabilities,
        ),
    )
    return registry
