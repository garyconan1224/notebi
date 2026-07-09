"""shared/storyboard_generator.py 最小 smoke 测试。

仅验证模块可被 import，且核心公开函数签名存在、关键参数名未被误删；
不真正调用下游 LLM / 文件系统。
"""

from __future__ import annotations

import inspect


def test_storyboard_module_imports() -> None:
    """模块可 import，且 2 个核心公开函数存在。"""
    from shared import storyboard_generator

    assert hasattr(storyboard_generator, "run_storyboard_generation")
    assert hasattr(storyboard_generator, "resolve_chat_profile_for_storyboard")


def test_core_function_signatures() -> None:
    """核心函数签名里应保留关键关键字参数（keyword-only）。"""
    from shared.storyboard_generator import (
        resolve_chat_profile_for_storyboard,
        run_storyboard_generation,
    )

    sig_run = inspect.signature(run_storyboard_generation)
    # 这些字段是后端 storyboard 任务 handler 的契约，丢失任一都是回归
    for name in (
        "project_id",
        "product_name",
        "core_features",
        "web_enrichment_md",
    ):
        assert name in sig_run.parameters, f"run_storyboard_generation missing param: {name}"

    sig_resolve = inspect.signature(resolve_chat_profile_for_storyboard)
    for name in (
        "settings",
        "text_backend",
        "api_key_override",
        "anthropic_key_override",
    ):
        assert name in sig_resolve.parameters, f"resolve_chat_profile_for_storyboard missing param: {name}"

