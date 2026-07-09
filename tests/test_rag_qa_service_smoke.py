"""backend/app/services/rag_qa_service.py 最小 smoke 测试。

- 验证模块可 import
- 验证核心函数 ``ask_with_sources`` 在 mock 掉向量库/LLM 之后能被调用，
  且返回结构包含 ``answer`` 与 ``sources`` 两个字段。
"""

from __future__ import annotations

import inspect
from typing import Any
from unittest.mock import MagicMock, patch


def test_rag_qa_service_imports() -> None:
    """模块可 import，核心函数存在且签名包含 query/embedding_model。"""
    from backend.app.services import rag_qa_service

    assert hasattr(rag_qa_service, "ask_with_sources")
    sig = inspect.signature(rag_qa_service.ask_with_sources)
    for name in ("project_json_dir", "query", "embedding_model"):
        assert name in sig.parameters, f"ask_with_sources missing param: {name}"


def test_ask_with_sources_callable_with_mocks() -> None:
    """mock 掉 settings / 知识库 / provider 后，``ask_with_sources`` 能端到端跑通。"""
    from backend.app.services import rag_qa_service
    from shared.knowledge_base import ShortKnowledge

    fake_settings = MagicMock()
    fake_settings.openai_api_key = "sk-fake"
    fake_settings.text_model = "gpt-fake"

    fake_knowledge = ShortKnowledge(
        mode="short", combined_json_text="dummy context", total_chars=13
    )

    fake_provider = MagicMock()
    fake_provider.chat.return_value = "answer-from-llm"
    fake_profile = MagicMock()
    fake_profile.default_models = {"chat": "gpt-fake"}
    fake_registry = MagicMock()
    fake_registry.resolve_default_profile.return_value = fake_profile
    fake_registry.build.return_value = fake_provider

    with (
        patch.object(rag_qa_service, "load_settings", return_value=fake_settings),
        patch.object(
            rag_qa_service,
            "load_folder_as_knowledge",
            return_value=fake_knowledge,
        ),
        patch.object(
            rag_qa_service,
            "create_default_registry",
            return_value=fake_registry,
        ),
    ):
        result: Any = rag_qa_service.ask_with_sources(
            project_json_dir="/tmp/does-not-matter",
            query="smoke?",
            embedding_model="bge-fake",
            api_key="sk-fake",
        )

    assert isinstance(result, dict)
    assert set(result.keys()) == {"answer", "sources"}
    assert result["answer"] == "answer-from-llm"
    assert isinstance(result["sources"], list) and len(result["sources"]) == 1

