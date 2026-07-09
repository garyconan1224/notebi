"""Tavily 联网搜索封装。

用于总结生成时补充外部知识。如果 TAVILY_API_KEY 未配置，搜索会静默跳过（不阻断总结生成）。
"""

from __future__ import annotations

import logging
import os
from typing import List, TypedDict

logger = logging.getLogger(__name__)


class SearchResult(TypedDict):
    title: str
    snippet: str
    url: str


def search_web_context(query: str, max_results: int = 5) -> List[SearchResult]:
    """用 Tavily 搜索补充上下文。无 key 或搜索失败时返回空列表。"""
    # 优先从 settings 读，fallback 到环境变量
    from shared.settings_store import load_settings
    settings = load_settings()
    api_key = settings.tavily_api_key.strip() or os.getenv("TAVILY_API_KEY", "").strip()
    if not api_key:
        logger.info("TAVILY_API_KEY 未配置，跳过联网搜索")
        return []

    try:
        from tavily import TavilyClient

        client = TavilyClient(api_key=api_key)
        logger.info("Tavily 搜索: query=%s, max_results=%d", query[:80], max_results)
        response = client.search(query, max_results=max_results, search_depth="basic")
        results: List[SearchResult] = []
        for item in response.get("results", []):
            results.append({
                "title": item.get("title", ""),
                "snippet": item.get("content", ""),
                "url": item.get("url", ""),
            })
        logger.info("Tavily 搜索完成: %d 条结果", len(results))
        return results
    except Exception as exc:
        logger.warning("Tavily 搜索失败: %s", exc)
        return []


def format_search_context(results: List[SearchResult]) -> str:
    """把搜索结果格式化为可拼进 prompt 的文本块。"""
    if not results:
        return ""
    lines = ["以下是联网搜索到的补充信息，可参考但需结合原文判断准确性：\n"]
    for i, r in enumerate(results, 1):
        lines.append(f"[{i}] {r['title']}")
        lines.append(f"    {r['snippet']}")
        lines.append(f"    来源: {r['url']}\n")
    return "\n".join(lines)
