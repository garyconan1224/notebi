"""Provider interface abstraction."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Sequence

from src.vidmirror.core.providers.types import ChatRequest


class BaseProvider(ABC):
    provider_id: str
    display_name: str
    capabilities: tuple[str, ...]

    def __init__(self, provider_id: str, display_name: str, capabilities: tuple[str, ...]) -> None:
        self.provider_id = provider_id
        self.display_name = display_name
        self.capabilities = capabilities

    def supports(self, capability: str) -> bool:
        return capability in self.capabilities

    @abstractmethod
    def test_connection(self) -> str:
        """Return a lightweight connectivity summary."""

    def list_models(self, capability: str) -> list[str]:
        raise NotImplementedError(f"list_models not implemented for {self.provider_id}:{capability}")

    def chat(self, req: ChatRequest) -> str:
        raise NotImplementedError(f"chat not implemented for {self.provider_id}")

    def create_embeddings(self, model: str, inputs: Sequence[str]) -> list[list[float]]:
        raise NotImplementedError(f"create_embeddings not implemented for {self.provider_id}")

    def rerank(self, model: str, query: str, documents: Sequence[str], top_n: int) -> list[dict[str, Any]]:
        raise NotImplementedError(f"rerank not implemented for {self.provider_id}")
