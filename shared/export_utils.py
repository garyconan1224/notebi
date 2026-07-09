"""
导出工具：将当前项目状态渲染为可交付 Markdown 文档。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def _now_local_str() -> str:
    return datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")


def build_export_markdown(payload: dict[str, Any], include_all_plans: bool = True) -> str:
    """
    将项目快照渲染为 Markdown。
    """
    project_name = str(payload.get("project_name") or "未命名项目")
    product_name = str(payload.get("product_name") or "")
    core_features = str(payload.get("core_features") or "")
    generated_at = str(payload.get("generated_at") or _now_local_str())
    models = payload.get("models") or {}
    plans = payload.get("plans") or {}
    plan_a = str(plans.get("plan_a") or "")
    plan_b = str(plans.get("plan_b") or "")
    plan_c = str(plans.get("plan_c") or "")
    vision_report = str(payload.get("vision_report") or "")
    web_context = str(payload.get("web_context_used") or "")

    lines: list[str] = [
        f"# {project_name}",
        "",
        "## 项目信息",
        f"- 导出时间: {generated_at}",
        f"- 产品名称: {product_name or '（未填写）'}",
        f"- 核心卖点: {core_features or '（未填写）'}",
        "",
        "## 模型配置",
        f"- 文本模型: {models.get('text_model', '（未知）')}",
        f"- 视觉模型: {models.get('vision_model', '（未知）')}",
        f"- 嵌入模型: {models.get('embedding_model', '（未知）')}",
        "",
    ]

    if web_context:
        lines.extend(
            [
                "## 联网摘录（节选）",
                "",
                web_context,
                "",
            ]
        )
    if vision_report:
        lines.extend(
            [
                "## 视觉分析报告",
                "",
                vision_report,
                "",
            ]
        )

    if include_all_plans:
        lines.extend(
            [
                "## 方案 A",
                "",
                plan_a or "_空_",
                "",
                "## 方案 B",
                "",
                plan_b or "_空_",
                "",
                "## 方案 C",
                "",
                plan_c or "_空_",
                "",
            ]
        )
    else:
        chosen = str(payload.get("selected_plan") or "A").upper()
        plan_map = {"A": plan_a, "B": plan_b, "C": plan_c}
        lines.extend(
            [
                f"## 方案 {chosen}",
                "",
                plan_map.get(chosen, "") or "_空_",
                "",
            ]
        )

    return "\n".join(lines).strip() + "\n"
