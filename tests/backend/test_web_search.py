from __future__ import annotations

import sys
import types
from types import SimpleNamespace

from backend.app.services import web_search


def test_search_skips_network_without_api_key(monkeypatch) -> None:
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    monkeypatch.setattr(
        "shared.settings_store.load_settings",
        lambda: SimpleNamespace(tavily_api_key=""),
    )

    assert web_search.search_web_context("NoteBi") == []


def test_search_normalizes_tavily_results(monkeypatch) -> None:
    monkeypatch.setattr(
        "shared.settings_store.load_settings",
        lambda: SimpleNamespace(tavily_api_key="settings-key"),
    )

    class Client:
        def __init__(self, api_key):
            assert api_key == "settings-key"

        def search(self, query, **kwargs):
            assert query == "NoteBi"
            assert kwargs == {"max_results": 2, "search_depth": "basic"}
            return {
                "results": [
                    {"title": "结果", "content": "摘要", "url": "https://example.com"}
                ]
            }

    fake_tavily = types.ModuleType("tavily")
    fake_tavily.TavilyClient = Client  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "tavily", fake_tavily)

    assert web_search.search_web_context("NoteBi", max_results=2) == [
        {"title": "结果", "snippet": "摘要", "url": "https://example.com"}
    ]


def test_search_failure_is_non_blocking(monkeypatch) -> None:
    monkeypatch.setattr(
        "shared.settings_store.load_settings",
        lambda: SimpleNamespace(tavily_api_key="settings-key"),
    )
    fake_tavily = types.ModuleType("tavily")
    fake_tavily.TavilyClient = lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("offline"))  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "tavily", fake_tavily)

    assert web_search.search_web_context("NoteBi") == []


def test_format_search_context_keeps_source_links() -> None:
    formatted = web_search.format_search_context(
        [{"title": "标题", "snippet": "摘要", "url": "https://example.com/source"}]
    )
    assert "[1] 标题" in formatted
    assert "摘要" in formatted
    assert "https://example.com/source" in formatted
