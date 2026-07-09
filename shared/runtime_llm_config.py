"""
从 AppSettings / Provider Profiles 解析运行时 LLM 凭据与默认模型。
供 Streamlit 各页与后端任务共用，避免侧栏重复配置。
"""

from __future__ import annotations

from typing import Literal

from shared.api_key_resolver import resolve_api_key, resolve_anthropic_api_key
from shared.config import (
    EMBEDDING_MODEL,
    RERANKER_MODEL,
    TEXT_BACKEND_ANTHROPIC,
    TEXT_MODEL_ANALYZER,
    VISION_MODEL_ANALYZER,
    VISION_MODEL_DEFAULT,
)
from shared.settings_store import AppSettings, load_settings
from src.vidmirror.core.providers.registry import create_default_registry

Capability = Literal["chat", "vision", "embedding", "rerank"]


def _registry():
    return create_default_registry()


def _setting_str(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _profile_for_capability(settings: AppSettings, capability: Capability):
    reg = _registry()
    try:
        return reg.resolve_default_profile(settings, capability)
    except Exception:
        return None


def get_openai_compat_api_key(settings: AppSettings | None = None) -> str:
    """
    OpenAI 兼容端（嵌入 / 视觉 / 文本）密钥。
    优先：embedding → vision → chat 能力下、已启用的 openai_compatible Provider；
    其次：resolve_api_key（含旧 settings.openai_api_key / 环境变量）。
    """
    s = settings or load_settings()
    for cap in ("embedding", "vision", "chat"):
        p = _profile_for_capability(s, cap)  # type: ignore[arg-type]
        if p is None:
            continue
        if p.kind == "openai_compatible" and (p.api_key or "").strip():
            return p.api_key.strip()
    legacy = (s.openai_api_key or "").strip()
    if legacy:
        return legacy
    return resolve_api_key("")


def get_anthropic_api_key(settings: AppSettings | None = None) -> str:
    s = settings or load_settings()
    p = _profile_for_capability(s, "chat")
    if p is not None and p.kind == "anthropic" and (p.api_key or "").strip():
        return p.api_key.strip()
    legacy = (s.anthropic_api_key or "").strip()
    if legacy:
        return legacy
    return resolve_anthropic_api_key("")


def get_default_model(
    settings: AppSettings | None,
    capability: Capability,
    *,
    text_backend: str | None = None,
) -> str:
    """
    从默认 Provider 的 default_models 读取；缺省回退到 shared.config 常量。
    chat 在 text_backend 为 anthropic 时使用 anthropic 侧 chat profile 的模型字段。
    """
    s = settings or load_settings()
    backend = text_backend or s.text_backend
    if capability == "chat" and backend == TEXT_BACKEND_ANTHROPIC:
        p = _profile_for_capability(s, "chat")
        if p is not None and p.kind == "anthropic":
            m = (p.default_models.get("chat") or "").strip()
            if m:
                return m
        return (s.anthropic_model or "").strip() or "claude-sonnet-4-20250514"

    cap_map: dict[str, Capability] = {
        "chat": "chat",
        "vision": "vision",
        "embedding": "embedding",
        "rerank": "rerank",
    }
    p = _profile_for_capability(s, cap_map[capability])
    if p is not None:
        m = (p.default_models.get(capability) or "").strip()
        if m:
            return m

    if capability == "vision":
        return _setting_str(s.vision_model) or VISION_MODEL_ANALYZER
    if capability == "embedding":
        return _setting_str(s.embedding_model) or EMBEDDING_MODEL
    if capability == "rerank":
        return _setting_str(getattr(s, "rerank_model", "")) or RERANKER_MODEL
    return _setting_str(s.text_model) or TEXT_MODEL_ANALYZER


def get_vision_model_for_analyzer(settings: AppSettings | None = None) -> str:
    m = get_default_model(settings, "vision")
    return m or VISION_MODEL_ANALYZER


def get_text_model_for_analyzer(settings: AppSettings | None = None) -> str:
    m = get_default_model(settings, "chat")
    return m or TEXT_MODEL_ANALYZER


def get_embedding_model_for_rag(settings: AppSettings | None = None) -> str:
    m = get_default_model(settings, "embedding")
    return m or EMBEDDING_MODEL


def get_reranker_model_for_rag(settings: AppSettings | None = None) -> str:
    m = get_default_model(settings, "rerank")
    return m or RERANKER_MODEL


def get_vision_model_for_storyboard(settings: AppSettings | None = None) -> str:
    m = get_default_model(settings, "vision")
    return m or VISION_MODEL_DEFAULT


def get_openai_chat_model(settings: AppSettings | None = None) -> str:
    """分镜在 OpenAI 兼容文本后端时使用的 chat 模型（显式找 openai_compatible 的 chat Provider）。"""
    s = settings or load_settings()
    reg = _registry()
    for p in reg.list_profiles(s, "chat"):
        if p.kind == "openai_compatible":
            m = (p.default_models.get("chat") or "").strip()
            if m:
                return m
    return (s.text_model or "").strip() or TEXT_MODEL_ANALYZER


def get_anthropic_model_for_storyboard(settings: AppSettings | None = None) -> str:
    s = settings or load_settings()
    p = _profile_for_capability(s, "chat")
    if p is not None and p.kind == "anthropic":
        m = (p.default_models.get("chat") or "").strip()
        if m:
            return m
    return (s.anthropic_model or "").strip() or "claude-sonnet-4-20250514"
