"""OpenAI-compatible provider adapter using shared.sf_client."""

from __future__ import annotations

from typing import Any, Sequence

from shared.sf_client import (
    SiliconFlowError,
    chat_completion,
    create_embeddings,
    get_model_ids,
    rerank_documents,
)
from src.vidmirror.core.providers.base import BaseProvider
from src.vidmirror.core.providers.types import ChatRequest, ProviderRequestError


class OpenAICompatProvider(BaseProvider):
    def __init__(
        self,
        *,
        provider_id: str,
        display_name: str,
        api_key: str,
        base_url: str = "",
        capabilities: tuple[str, ...] = ("chat", "vision", "embedding", "rerank"),
    ) -> None:
        super().__init__(provider_id=provider_id, display_name=display_name, capabilities=capabilities)
        self.api_key = (api_key or "").strip()
        self.base_url = (base_url or "").strip()

    def test_connection(self) -> str:
        if not self.api_key:
            raise ProviderRequestError("missing api_key")
        try:
            models = get_model_ids(self.api_key, "chat", base_url=self.base_url or None)
            return f"ok: chat_models={len(models)}"
        except SiliconFlowError as err:
            raise ProviderRequestError(str(err)) from err

    def list_models(self, capability: str) -> list[str]:
        if not self.api_key:
            return []
        sub_type = {
            "chat": "chat",
            "vision": "chat",
            "embedding": "embedding",
            "rerank": "reranker",
        }.get(capability, "chat")
        return get_model_ids(self.api_key, sub_type, base_url=self.base_url or None)

    def chat(self, req: ChatRequest) -> str:
        if not self.api_key:
            raise ProviderRequestError("missing api_key")
        kwargs: dict[str, Any] = {
            "temperature": req.temperature,
            "timeout": req.timeout or 300,
            "base_url": self.base_url or None,
        }
        if req.reasoning_effort:
            kwargs["reasoning_effort"] = req.reasoning_effort
        if req.enable_thinking is not None:
            kwargs["enable_thinking"] = req.enable_thinking
        try:
            return chat_completion(
                self.api_key,
                req.model,
                req.messages,
                max_tokens=req.max_tokens,
                **kwargs,
            )
        except SiliconFlowError as err:
            # Some reasoning models reject temperature entirely. Retry once
            # without it; all other provider errors remain unchanged.
            detail = str(err).lower()
            if req.temperature is not None and "temperature" in detail and any(
                marker in detail for marker in ("unsupported", "not support", "invalid", "unknown")
            ):
                kwargs.pop("temperature", None)
                try:
                    return chat_completion(
                        self.api_key,
                        req.model,
                        req.messages,
                        max_tokens=req.max_tokens,
                        **kwargs,
                    )
                except SiliconFlowError as retry_err:
                    raise ProviderRequestError(str(retry_err)) from retry_err
            raise ProviderRequestError(str(err)) from err

    def create_embeddings(self, model: str, inputs: Sequence[str]) -> list[list[float]]:
        if not self.api_key:
            raise ProviderRequestError("missing api_key")
        try:
            return create_embeddings(self.api_key, model, inputs, base_url=self.base_url or None)
        except SiliconFlowError as err:
            raise ProviderRequestError(str(err)) from err

    def rerank(self, model: str, query: str, documents: Sequence[str], top_n: int) -> list[dict[str, Any]]:
        if not self.api_key:
            raise ProviderRequestError("missing api_key")
        try:
            return rerank_documents(
                self.api_key,
                model,
                query,
                documents,
                top_n,
                base_url=self.base_url or None,
            )
        except SiliconFlowError as err:
            raise ProviderRequestError(str(err)) from err
