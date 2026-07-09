"""OpenAI-compatible provider adapter using shared.sf_client."""

from __future__ import annotations

import os
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

    def _with_base_url_env(self) -> tuple[bool, str | None]:
        if not self.base_url:
            return False, None
        old = os.environ.get("LLM_BASE_URL")
        os.environ["LLM_BASE_URL"] = self.base_url
        return True, old

    def _restore_base_url_env(self, enabled: bool, old: str | None) -> None:
        if not enabled:
            return
        if old is None:
            os.environ.pop("LLM_BASE_URL", None)
        else:
            os.environ["LLM_BASE_URL"] = old

    def test_connection(self) -> str:
        if not self.api_key:
            raise ProviderRequestError("missing api_key")
        patched, old = self._with_base_url_env()
        try:
            models = get_model_ids(self.api_key, "chat")
            return f"ok: chat_models={len(models)}"
        except SiliconFlowError as err:
            raise ProviderRequestError(str(err)) from err
        finally:
            self._restore_base_url_env(patched, old)

    def list_models(self, capability: str) -> list[str]:
        if not self.api_key:
            return []
        sub_type = {
            "chat": "chat",
            "vision": "chat",
            "embedding": "embedding",
            "rerank": "reranker",
        }.get(capability, "chat")
        patched, old = self._with_base_url_env()
        try:
            return get_model_ids(self.api_key, sub_type)
        finally:
            self._restore_base_url_env(patched, old)

    def chat(self, req: ChatRequest) -> str:
        if not self.api_key:
            raise ProviderRequestError("missing api_key")
        patched, old = self._with_base_url_env()
        try:
            return chat_completion(
                self.api_key,
                req.model,
                req.messages,
                temperature=req.temperature,
                max_tokens=req.max_tokens,
                timeout=req.timeout or 300,
            )
        except SiliconFlowError as err:
            raise ProviderRequestError(str(err)) from err
        finally:
            self._restore_base_url_env(patched, old)

    def create_embeddings(self, model: str, inputs: Sequence[str]) -> list[list[float]]:
        if not self.api_key:
            raise ProviderRequestError("missing api_key")
        patched, old = self._with_base_url_env()
        try:
            return create_embeddings(self.api_key, model, inputs)
        except SiliconFlowError as err:
            raise ProviderRequestError(str(err)) from err
        finally:
            self._restore_base_url_env(patched, old)

    def rerank(self, model: str, query: str, documents: Sequence[str], top_n: int) -> list[dict[str, Any]]:
        if not self.api_key:
            raise ProviderRequestError("missing api_key")
        patched, old = self._with_base_url_env()
        try:
            return rerank_documents(self.api_key, model, query, documents, top_n)
        except SiliconFlowError as err:
            raise ProviderRequestError(str(err)) from err
        finally:
            self._restore_base_url_env(patched, old)
