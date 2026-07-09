"""
解析 API Key：侧边栏临时输入优先，其次本地 settings，再次环境变量，最后 local_settings.py。
支持 OpenAI 兼容端：SILICONFLOW_API_KEY / LLM_API_KEY / OPENAI_API_KEY。
Anthropic：ANTHROPIC_API_KEY（创作工作台文本后端选 Anthropic 时使用）。
"""

from __future__ import annotations

import os

from shared.dotenv_loader import load_dotenv_if_present
from shared.settings_store import load_settings

load_dotenv_if_present()


def resolve_api_key(sidebar_value: str) -> str:
    """OpenAI 兼容端（嵌入 / Rerank / Chat / 视觉）。sidebar > settings > env > local_settings。"""
    s = (sidebar_value or "").strip()
    if s:
        return s
    local = load_settings().openai_api_key.strip()
    if local:
        return local
    for env_var in ("SILICONFLOW_API_KEY", "LLM_API_KEY", "OPENAI_API_KEY"):
        env = (os.environ.get(env_var) or "").strip()
        if env:
            return env
    try:
        import sys
        from pathlib import Path
        root = Path(__file__).resolve().parent.parent
        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        from local_settings import SILICONFLOW_API_KEY as f  # type: ignore[import-not-found]
        return (f or "").strip()
    except ImportError:
        return ""


def resolve_anthropic_api_key(sidebar_value: str) -> str:
    """Anthropic Messages API。侧边栏非空优先，否则 ANTHROPIC_API_KEY。"""
    s = (sidebar_value or "").strip()
    if s:
        return s
    env = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if env:
        return env
    return load_settings().anthropic_api_key.strip()


def has_builtin_api_key() -> bool:
    """是否已在环境变量或 local_settings 中配置 OpenAI 兼容 Key。"""
    if any((os.environ.get(k) or "").strip() for k in ("SILICONFLOW_API_KEY", "LLM_API_KEY", "OPENAI_API_KEY")):
        return True
    if load_settings().openai_api_key.strip():
        return True
    try:
        import sys
        from pathlib import Path
        root = Path(__file__).resolve().parent.parent
        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        from local_settings import SILICONFLOW_API_KEY as f  # type: ignore[import-not-found]
        return bool((f or "").strip())
    except ImportError:
        return False


def has_anthropic_api_key() -> bool:
    return bool((os.environ.get("ANTHROPIC_API_KEY") or "").strip() or load_settings().anthropic_api_key.strip())
