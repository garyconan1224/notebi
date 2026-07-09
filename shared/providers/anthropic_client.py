"""
Anthropic Messages API 最小封装（/v1/messages）。
用于创作工作台在「文本后端 = Anthropic」时生成分镜脚本。
"""

from __future__ import annotations

import json
from typing import Any

import requests
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from shared.config import ANTHROPIC_MESSAGES_VERSION, get_anthropic_api_base_url


class AnthropicError(RuntimeError):
    """Anthropic 返回非预期状态或业务错误。"""


class AnthropicTransientError(RuntimeError):
    """可重试错误（限流、5xx）。"""


def _parse_assistant_text(data: dict[str, Any]) -> str:
    parts: list[str] = []
    for block in data.get("content") or []:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text" and isinstance(block.get("text"), str):
            parts.append(block["text"])
    if not parts:
        raise AnthropicError(f"无法解析 Anthropic 响应: {data}")
    return "".join(parts).strip()


@retry(
    reraise=True,
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=1, min=2, max=60),
    retry=retry_if_exception_type(
        (
            requests.Timeout,
            requests.ConnectionError,
            AnthropicTransientError,
        )
    ),
)
def messages_completion(
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    *,
    max_tokens: int = 8192,
    temperature: float = 0.75,
    timeout: int = 300,
) -> str:
    """
    将 OpenAI 风格的 chat messages（role + content 字符串）映射为 Anthropic Messages。
    - system 角色合并为一条 system 字符串；
    - user / assistant 按顺序合并为单条 user 文本（简化实现，满足分镜单轮对话）。
    """
    k = (api_key or "").strip()
    if not k:
        raise AnthropicError("未配置 Anthropic API Key")

    system_parts: list[str] = []
    convo: list[str] = []
    for m in messages:
        role = (m.get("role") or "").strip()
        content = m.get("content", "")
        if not isinstance(content, str):
            content = str(content)
        if role == "system":
            system_parts.append(content)
        elif role == "user":
            convo.append(content)
        elif role == "assistant":
            convo.append(f"[assistant]\n{content}")

    user_blob = "\n\n".join(convo).strip()
    if not user_blob:
        raise AnthropicError("消息为空")

    url = f"{get_anthropic_api_base_url()}/v1/messages"
    headers = {
        "x-api-key": k,
        "anthropic-version": ANTHROPIC_MESSAGES_VERSION,
        "Content-Type": "application/json",
    }
    body: dict[str, Any] = {
        "model": model.strip(),
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": user_blob}],
    }
    sp = "\n\n".join(system_parts).strip()
    if sp:
        body["system"] = sp[:200_000]
    body["temperature"] = temperature

    resp = requests.post(url, headers=headers, json=body, timeout=timeout)
    if resp.status_code in (429, 500, 502, 503, 504):
        raise AnthropicTransientError(f"HTTP {resp.status_code}: {resp.text[:500]}")
    if resp.status_code >= 400:
        try:
            detail = resp.json()
        except json.JSONDecodeError:
            detail = resp.text
        raise AnthropicError(f"HTTP {resp.status_code}: {detail}")

    data = resp.json()
    return _parse_assistant_text(data)


def explain_anthropic_error(err: Exception) -> str:
    msg = str(err)
    low = msg.lower()
    if "401" in low or "403" in low or "invalid" in low and "key" in low:
        return "Anthropic 鉴权失败。请检查 ANTHROPIC_API_KEY 或侧边栏密钥。"
    if "429" in low or "rate" in low:
        return "Anthropic 限流，请稍后重试。"
    if isinstance(err, (requests.Timeout, requests.ConnectionError)):
        return "网络超时或连接失败。"
    return f"{msg}。可稍后重试或更换模型。"
