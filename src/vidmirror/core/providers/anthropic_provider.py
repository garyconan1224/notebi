"""Anthropic provider adapter using shared anthropic client."""

from __future__ import annotations

import os

from shared.providers.anthropic_client import AnthropicError, messages_completion
from src.vidmirror.core.providers.base import BaseProvider
from src.vidmirror.core.providers.types import ChatRequest, ProviderRequestError


class AnthropicProvider(BaseProvider):
    def __init__(
        self,
        *,
        provider_id: str,
        display_name: str,
        api_key: str,
        base_url: str = "",
        capabilities: tuple[str, ...] = ("chat",),
    ) -> None:
        super().__init__(provider_id=provider_id, display_name=display_name, capabilities=capabilities)
        self.api_key = (api_key or "").strip()
        self.base_url = (base_url or "").strip()

    def _with_base_url_env(self) -> tuple[bool, str | None]:
        if not self.base_url:
            return False, None
        old = os.environ.get("ANTHROPIC_API_BASE_URL")
        os.environ["ANTHROPIC_API_BASE_URL"] = self.base_url
        return True, old

    def _restore_base_url_env(self, enabled: bool, old: str | None) -> None:
        if not enabled:
            return
        if old is None:
            os.environ.pop("ANTHROPIC_API_BASE_URL", None)
        else:
            os.environ["ANTHROPIC_API_BASE_URL"] = old

    def test_connection(self) -> str:
        if not self.api_key:
            raise ProviderRequestError("missing api_key")
        patched, old = self._with_base_url_env()
        try:
            _ = messages_completion(
                self.api_key,
                "claude-3-5-haiku-20241022",
                [{"role": "user", "content": "Reply with OK only."}],
                max_tokens=8,
                temperature=0.0,
            )
            return "ok"
        except AnthropicError as err:
            raise ProviderRequestError(str(err)) from err
        finally:
            self._restore_base_url_env(patched, old)

    def chat(self, req: ChatRequest) -> str:
        if not self.api_key:
            raise ProviderRequestError("missing api_key")
        patched, old = self._with_base_url_env()
        try:
            return messages_completion(
                self.api_key,
                req.model,
                req.messages,
                max_tokens=req.max_tokens,
                temperature=req.temperature,
                timeout=req.timeout or 300,
            )
        except AnthropicError as err:
            raise ProviderRequestError(str(err)) from err
        finally:
            self._restore_base_url_env(patched, old)
