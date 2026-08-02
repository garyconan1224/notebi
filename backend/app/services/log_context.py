"""S6 — 日志上下文传播（contextvars）。

让同一任务 / 批次 / 合集 / 相关 ID 自动进入日志上下文：

- ``log_context(**fields)`` 上下文管理器：在作用域内绑定 ID，退出自动复位；
- ``get_log_context()``：读取当前上下文副本，供统一日志收集层补齐字段；
- 仅允许白名单字段（task_id / batch_id / workspace_id / correlation_id），
  其余字段忽略，避免任意键进入日志；
- 嵌套作用域：内层覆盖同名字段，退出内层恢复外层；
- 线程池复用安全：基于 ContextVar token 复位，不会把 A 任务的 ID 泄漏给
  随后复用同一线程的 B 任务。

不落库、不改 schema：上下文只在进程内传播，最终由 RuntimeLogStore 写入
既有 JSONL 字段。
"""

from __future__ import annotations

import contextvars
from contextlib import contextmanager
from typing import Any, Dict, Iterator

#: 允许进入日志上下文的字段白名单。
ALLOWED_CONTEXT_FIELDS = frozenset(
    {"task_id", "batch_id", "workspace_id", "correlation_id"}
)

_LOG_CONTEXT: contextvars.ContextVar[Dict[str, str]] = contextvars.ContextVar(
    "notebi_log_context", default={}
)


def bind_log_context(**fields: Any) -> contextvars.Token:
    """在当前上下文叠加绑定 ID，返回用于复位的 token。

    None / 空字符串视为不绑定；白名单外的字段忽略。
    """
    merged = dict(_LOG_CONTEXT.get())
    for key, value in fields.items():
        if key not in ALLOWED_CONTEXT_FIELDS:
            continue
        if value is None or str(value) == "":
            continue
        merged[key] = str(value)
    return _LOG_CONTEXT.set(merged)


def reset_log_context(token: contextvars.Token) -> None:
    """复位到 bind_log_context 之前的上下文。"""
    _LOG_CONTEXT.reset(token)


@contextmanager
def log_context(**fields: Any) -> Iterator[None]:
    """上下文管理器：作用域内绑定 ID，退出自动复位。"""
    token = bind_log_context(**fields)
    try:
        yield
    finally:
        _LOG_CONTEXT.reset(token)


def get_log_context() -> Dict[str, str]:
    """返回当前日志上下文副本（无绑定时为空 dict）。"""
    return dict(_LOG_CONTEXT.get())
